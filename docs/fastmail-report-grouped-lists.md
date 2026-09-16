# Grouped mailbox lists: wrong groups from the server

Two problems with `Email/query` when a mailbox is grouped with a `category`
sort (`groupBy`). Both come from the API server. The offline worker in the
web app answers the same queries correctly, so they only show on devices
without a complete offline copy, such as the web app on a phone.

Seen on the beta API (`ams.api.beta.fastmail.com`, used by
app.beta.fastmail.com), 17 September 2026; not tried against the production
API. The requests below were sent as shown, with real ids in place of the
placeholders. Grouping is part of the `https://www.fastmail.com/dev/mail`
capability: with only `urn:ietf:params:jmap:mail` in `using`, any `category`
sort is refused with `unsupportedSort`.

## 1. A group for an empty label takes every conversation

If one of the `groupBy` conditions is `inMailbox` for a label that holds no
messages, that group matches every conversation not taken by an earlier
group. Every group after it comes back empty.

Setup: an Inbox with 259 conversations, an empty label (0 messages), and a
label `Later` holding 3 of the Inbox conversations.

Request:

```json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "https://www.fastmail.com/dev/mail"
  ],
  "methodCalls": [
    ["Email/query", {
      "accountId": "<account id>",
      "filter": { "inMailbox": "<Inbox id>" },
      "sort": [
        { "property": "category", "isAscending": true,
          "groupBy": [
            { "inMailbox": "<empty label id>" },
            { "inMailbox": "<Later id>" }
          ] },
        { "property": "receivedAt", "isAscending": false }
      ],
      "collapseThreads": true,
      "calculateTotal": true,
      "limit": 10
    }, "0"]
  ]
}
```

Expected: `"total": 259, "groupByCounts": [0, 3]`

Actual: `"total": 259, "groupByCounts": [259, 0]`

With the two groups swapped (`Later` first, the empty label second) the
answer is `[3, 256]`: the empty label's group takes everything `Later` did
not.

The same condition as a plain filter is correct:

```json
["Email/query", {
  "accountId": "<account id>",
  "filter": { "inMailbox": "<empty label id>" },
  "calculateTotal": true,
  "limit": 10
}, "0"]
```

returns `"total": 0`.

Notes:

- A label with a single message behaves correctly. Only labels with 0
  messages do this, whatever their name.
- It happens with or without the `receivedAt` sort, with `collapseThreads`
  on or off, and when the condition is wrapped in `AND`, `OR` or `NOT NOT`.
- In the web app this shows as one label's group holding conversations that
  are not in that label, with every group below it empty.

## 2. More than 32 groups fails with `unsupportedSort`

The same request as above, with `groupBy` holding the one condition
`{ "inMailbox": "<Later id>" }` repeated:

- 32 times: `"total": 259, "groupByCounts": [3, 0, 0, …]` (32 entries)
- 33 times:

  ```json
  ["error", { "type": "unsupportedSort", "sort": ["sort[0]"] }, "0"]
  ```

Real groupings with 33 or more different conditions fail the same way.

The error does not say that the number of groups is the problem, and the
limit does not seem to be documented. In the web app the list then shows the
empty-mailbox message instead of an error. The offline worker answers the
same query without complaint.

Expected: either no limit, or an error that names the limit.

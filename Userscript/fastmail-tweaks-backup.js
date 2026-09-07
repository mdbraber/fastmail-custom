/*
Fastmail Extra
Maarten den Braber <m@mdbraber.com>
version 1.0 - 2023-12-19

# Functionalities

* Show and dynamically update badges with pinned counts per mailbox
* Show and dynamically update badges with counts for saved searches
* Added mailbox title with count
* Shortcuts to navigate sources (mailboxes or saved searches)

# Workflow

1. Pinned messages indicate 'actionable' messages
2. Unpinned messaged indicate 'non-actionable' messages (e.g. waiting for an answer)
3. Inbox is only used for triage, messages are to be moved to a special label/folder as a 'per-project inbox'
4. Processed messages are archived (removed from Inbox and special label/folder )
5. Pinned count (shown as badge and in title) in special label/folder indicates number of actionable messages

# Tips

- Special label/folder can be a main folder with children to create structure. E.g. a label "Work" with all your
  work project nested below and a label "Personal" with all your personal projects nested below. You only have to
  set _specialMailboxes to the main folder(s) and it will automatically to children. 
- When using this script the 'total' count for mailboxes is set to the 'pinned' count of the mailbox, 
  so you can use 'Hide when empty' setting to hide a mailbox when it doesn't contain pinned
  messages

# Todo

- [ ] Remove label from converstation when archiving message from Inbox

*/ 


(function() {
    'use strict';

    /*
     * ----------------------------------------------------------------
     * Main routine
     * ----------------------------------------------------------------
     */

    const mainObserver = new MutationObserver(() => {

        // Wait for FastMail to load
        if (!FastMail || !FastMail.activeViews || (!FastMail.activeViews.v78 && !FastMail.activeViews.v212)) {
            return;
        }

        // Stop observing when FastMail has loaded
        mainObserver.disconnect();
       
        // Start!
        console.log("Enabling Fastmail tweaks")        

        // Special mailboxes (also includes children of these mailboxes)
        controller().set('_specialMailboxes', ["General", "Projects", "Admin"]);
        // Mailboxes to exclude from badge counts
        controller().set('_excludeCountMailboxes', ["Later", "Resource"]);

        // Initialize
        initUI();
        initBadges();

        // Shortcuts
        shortcutMailbox("Shift-I", "Inbox");
        shortcutMailbox("Meta-1", "Inbox");
        shortcut("Shift-J", navigateSourceNext);
        shortcut("Shift-K", navigateSourcePrev);

        // Add observers to watch for UI changes
        addObservers();
    });

    // Observer to check if FastMail has loaded...
    mainObserver.observe(document.body, {attributes: true, childList: true, subtree: true} );

    /*
     * ----------------------------------------------------------------
     * Observers
     * ----------------------------------------------------------------
     */

    const addObservers = () => {
        controller().addObserverForPath('mailboxMessageList.status', { go: function(_, __, ___, ____) {
            updateMailboxBadges();
            updateMailboxTitle();
        } }, 'go');

        controller().addObserverForKey('mailbox', { go: function(_, __, ___, ____) {
            updateMailboxBadges();
            updateMailboxTitle();
        } } , 'go');

        controller().addObserverForKey('savedSearch', { go: function(_, __, ___, ____) {
            updateMailboxTitle();
        } } , 'go');
    }

    /*
     * ----------------------------------------------------------------
     * Initialization
     * ----------------------------------------------------------------
     */
    
    const initUI = () => {

        /*
         * ------------------------------------------------------------
         * Mailbox title
         * ------------------------------------------------------------ 
         */

        const cssMailboxTitle = FastMail.el(
            'style',
            { type: 'text/css' },
            [ '.mdbraber-mailboxTitle { font-weight: bold; font-size: large; margin-left: -10px; }' ],
        );

        document.body.appendChild(cssMailboxTitle);

        // Create mailboxTitle view
        const view = new FastMail.classes.TextView({
            value: mailbox.get('name'),
            className: 'mdbraber-mailboxTitle',
            layerStyles: { }
        })
        
        // Insert mailboxTitle view
        FastMail.activeViews.v201.insertView(
            view,
            FastMail.activeViews.v108,
            'after'
        )
        
        controller().mailboxTitleView = view;

        /*
         * ------------------------------------------------------------
         * Badges
         * ------------------------------------------------------------ 
         */
        
        FastMail.store.getAll(FastMail.classes.Mailbox).forEach(
            mailbox => {
                const name = mailbox.get('name');
                const color = mailbox.get('color');
                
                if(isSpecialMailbox(mailbox)) {
                    const css = FastMail.el(
                        'style',
                        { type: 'text/css' },
                        [ `.v-mdbraber-Mailbox--${name.replaceAll(' ','')} .v-MailboxSource-badge { color: ${color}; border-color: ${color} }` ],
                    );
                    document.body.appendChild(css);
                }
            }
        );

        // Fix to prevent hover to obscure badge count
        const cssSearchSourceHover = FastMail.el(
            'style',
            { type: 'text/css' },
            [ '.v-SearchSource:hover .v-MailboxSource-badge { display: none }' ],
        );

        document.body.appendChild(cssSearchSourceHover);

        /*
         * ------------------------------------------------------------
         * Mailbox color
         * ------------------------------------------------------------ 
         */
 
        FastMail.classes.MailboxSourceView.prototype.className = function () {
            const mailbox = this.get('content');
            const role = mailbox.get( 'role' );
            const name = mailbox.get( 'name' );
            const isCollapsed = !this.get( 'hasSubfolders' ) || this.get( 'isCollapsed' );

            return 'v-MailboxSource' +
            ( role ? ' v-MailboxSource--' + role : '' ) +
            //( isSpecialMailbox(mailbox) ? ' mdbraber-MSV-inboxMailbox' : ''  ) +
            ( isSpecialMailbox(mailbox) ? ' v-mdbraber-Mailbox--' + name.replaceAll(' ','') : '' );
            ( isCollapsed ? '' : ' is-expanded' ) +
            ( isCollapsed && this.get( 'hasUnreadChildren' ) ? ' u-bold' : '' );
        }.property( 'hasSubfolders', 'isCollapsed', 'hasUnreadChildren' );

        getViewsByClass(FastMail.classes.MailboxSourceView).forEach(view => {
            view.computedPropertyDidChange('className')
        });    

    }

    const initBadges = () => {
        FastMail.classes.Mailbox.prototype.pinnedThreads = 0;
        FastMail.classes.Mailbox.prototype.badgeProperty = function () {
            const role = this.get('role');
            const name = this.get('name');
            // forceEmail determines if we're using emails or threads (FIXME: is this true?)
            const forceEmail = this.get('isShared') && !this.get('isSeenShared');

            if ( role === 'inbox' ) {
                //return 'unread';
                return forceEmail ? 'totalEmails' : 'total';
            } else if ( role === 'drafts' ) { 
                return 'totalEmails';
            } else if ( role === 'archive' || role === 'sent' || role === 'trash' || role === 'snoozed' ) {
                return null;
            // Exclude specific mailboxes from showing badge counts
            } else if (controller().get('_excludeCountMailboxes').includes(name)) {
                return null;
            } else if (isSpecialMailbox(this)) {
                return forceEmail ? 'totalEmails' : 'total';
            } else {
                return forceEmail ? 'unreadEmails' : 'unread';
                //return forceEmail ? 'totalEmails' : 'total';
            }
        }.property( 'role', 'isShared', 'isSeenShared', 'hidden' );

        FastMail.store.getAll(FastMail.classes.Mailbox).forEach(
            mailbox => mailbox.computedPropertyDidChange('badgeProperty')
        );
    }

    /*
     * ----------------------------------------------------------------
     * General helper functions
     * ----------------------------------------------------------------
     */

    // Get controller
    const controller = () => FastMail.router.getAppController('mail');

    // Get all mailboxes
    const getAllMailboxes = () => FastMail.store.getAll(FastMail.classes.Mailbox);

    // Get special mailboxes
    const getSpecialMailboxes = () => {
        let specialMailboxes = [];

        controller().get('_specialMailboxes').forEach(name => {
            let mailbox = FastMail.store.getOne(FastMail.classes.Mailbox, (data) => data.name == name);
            // FIXME: why is .get('[]') not working for subfolders?
            let subfolders = mailbox.get('subfolders').map(x => x);            
            specialMailboxes.push(mailbox);
            specialMailboxes.push(...subfolders);
        });

        console.log("specialMailboxes", specialMailboxes);
        return specialMailboxes;
    }

    // Get all the views of a given  FastMail.classes class in the app
    const getViewsByClass = (viewClass) => {
        return Object.values(FastMail.activeViews).filter(view => view instanceof viewClass);
    };
 
    // Check if this is a special mailbox (or child of a special mailbox)
    const isSpecialMailbox = (mailbox) => {
        const name = mailbox.get('name');
        let parentName = null;

        try {
            parentName = mailbox.get('parent').get('name')
        } catch { }

        return controller()._specialMailboxes.includes(parentName) || controller()._specialMailboxes.includes(name) || name.startsWith("_")
    } 

    // Create shortcut with specific function (no arguments)
    const shortcut = (keystroke, fn) => {
        FastMail.ViewEventsController.kbShortcuts.register(keystroke, { do: fn }, 'do');
    };

    // Create shortcut to specific mailbox
    const shortcutMailbox = (keystroke, mailboxName, mailboxFilter = '') => {
        shortcut(keystroke, () => {
            controller().goSource(
            FastMail.findMailbox(getAllMailboxes(), mailboxName),
            null, // search
            mailboxFilter // mailboxFilter
            );
        });
    }

    /*
     * ----------------------------------------------------------------
     * Query functions
     * ----------------------------------------------------------------
     */

    // This is a hacky way to force a query to refresh and load all the objects
    const refreshQuery = (query, callback) => {
        query.addObserverForRange({ start:0, end:999 }, { go: function() { } }, 'go');
        query.getStoreKeysForAllObjects(function () {
            //console.log("Refresh Query length: ", query.length)
            for(let i = 0; i < query.length; i++) {
                query.getObjectAt(i);
            }
            callback();
        });
    }

    // Async helper function to wait for a result to return true or until a specific timeout occurs
    async function waitFor(condition, step = 250, timeout = 5000) {
        return new Promise((resolve, reject) => {
          const now = Date.now();
          let running = false;
          const interval = setInterval(async () => {
            if (running) return;
            running = true;
            const result = await condition();
            if (result) {
              clearInterval(interval);
              resolve(result);
            } else if (Date.now() - now >= timeout * 1000) {
              clearInterval(interval);
              reject(result);
            }
            running = false;
          }, step);
        });
      }

    // Searches only get added to allQueries when the have been loaded at least once,
    // so we use goSource() to navigate there and back to Inbox at the end...
    const preloadSearch = async (search) => {
        // Navigate to search
        controller().goSource(null,search,null);

        // Get all messages
        const messageList = controller().mailboxMessageList();

        // Refresh query
        refreshQuery(messageList, async () => {
            // Wait for everything to be fetched
            await waitFor(() => messageList.checkIfEverythingIsFetched() == true);
            // Update UI if we're done
            updateMailboxBadges();
            updateSearchBadges();
        });
        
        // Navigate back to Inbox
        controller().goSource();

    }

    /*
     * ----------------------------------------------------------------
     * Search helpers
     * ----------------------------------------------------------------
     */ 

    const initSearches = () => {
        // Preload special searches
        controller().get('_specialSearches').forEach(s => preloadSearch(s));
 
        // Get all source groups
        const sourceGroups = FastMail.router.getAppController('mail').sources.sourceGroups().first()

        // Move special searches for waiting messages ("in:XXX AND is:unpinned") as a child of XXX
        // Rename to "Waiting"
        controller()._specialMailboxes.forEach(name => {
            // Find corresponding Mailbox
            const mailbox = FastMail.findMailbox(FastMail.store.getAll(FastMail.classes.Mailbox), name);
            // Find corresponding SavedSearch
            const search = sourceGroups.content.find(sg => sg.get('search') == `in:${name}/* AND is:unpinned`);
            
            // Set parent
            search.parent = mailbox;

            // Find the corresponding view
            const view = Object.values(FastMail.activeViews).find(view => view.content && view.content == search);
            
            // Adjust depth to parent+1 (make it a child)
            view.depth = search.parent.get('depth') + 1;
            view.computedPropertyDidChange('depth');
            
            // Rename to "Waiting"
            // We can only (temporary) change the displayName, because identical names are not allowed
            search.displayName = "Waiting";
            search.computedPropertyDidChange("displayName");
            
            // Toggle twice to update (yes, this is a hack!)
            mailbox.toggle('isCollapsed');
            mailbox.toggle('isCollapsed');
        })

        // Create CSS class to color SavedSearch icon based on parent color 
        FastMail.store.getAll(FastMail.classes.SavedSearch).forEach(
            savedSearch => {
                if(savedSearch.parent instanceof FastMail.classes.Mailbox) { 
                    const mailbox = savedSearch.parent;
                    const name = mailbox.get('name'); 
                    const color = mailbox.get('color');
                
                    if(isSpecialMailbox(mailbox)) {
                        const css = FastMail.el(
                            'style',
                            { type: 'text/css' },
                            [ 
                                `.v-mdbraber-Mailbox--${name.replaceAll(' ','')} .v-Icon { color: ${color}; }`
                            ],
                        );
                        document.body.appendChild(css);
                    }
                }
            }
        );

        // Make className dynamic for SearchSourceView so we can color icon based on parent
        FastMail.classes.SearchSourceView.prototype.className = function () {
            const mailbox = this.get('content').get('parent');

            if(mailbox instanceof FastMail.classes.Mailbox) {
                return 'v-SearchSource' +
                ( isSpecialMailbox(mailbox) ? ' v-mdbraber-Mailbox--' + mailbox.get('name').replaceAll(' ','') : '' );
            } else {
                return 'v-SearchSource';
            }
        }.property();

        // Update CSS classes for SearchSourceViews
        // We do this now, because this needs to be done *after* the parent has changed
        getViewsByClass(FastMail.classes.SearchSourceView).forEach(view => {
            view.computedPropertyDidChange('className');
        });

        // Add badge to SearchSourceView
        getViewsByClass(FastMail.classes.SearchSourceView).forEach(view => {
            let search = view.get('content').get('search');
            if(controller().get('_specialSearches').includes(search)) {

                // Create an updated draw function
                view.draw = function() {
                    // Apply the initial function
                    let res = FastMail.classes.SearchSourceView.prototype.draw.apply(this);
                    let search = view.get('content').get('search')
                    
                    if(controller().get('_specialSearches').includes(search)) {
                        let query = FastMail.store.getAllQueries().find(q => q.search == search);
                        // Create badge element
                        let el = FastMail.el('span', { class: 'v-MailboxSource-badge', text: query.length || 0 } );
                        // Append badge after the first element (which is the mailbox name)
                        res[0].appendChild(el);
                    }
                    return res;
                }
                
                // Disable redrawIsSelected() because it removes our added element
                // (doesn't seem to be causing problems for now...)
                view.redrawIsSelected = function(layer) { }
            }
        })

        // Update the search badges after we initialized everything
        updateSearchBadges();

    }

    // Update search queries
    const updateSearchQueries = () => {
        getViewsByClass(FastMail.classes.SearchSourceView).forEach(view => {
            let search = view.get('content').get('search');
            if(controller().get('_specialSearches').includes(search)) {
                let query = FastMail.store.getAllQueries().find(q => q.search == search);
                if(query) {
                    query.fetch();
                }           
            }
        })
    }

    /*
     * ----------------------------------------------------------------
     * Navigation functions
     * ----------------------------------------------------------------
     */

    const navigateSource = (increment) => {
        let sources = Object.values(document.querySelectorAll(".v-MailboxSource, .v-SearchSource"));
        let selectedId = document.querySelector('.v-MailboxSource > a.is-selected, .v-SearchSource > a.is-selected').parentElement.id;
        let selectedIndex = sources.map(e => e.id).indexOf(selectedId);
    
        let targetIndex = selectedIndex + increment;
        if (selectedIndex < sources.length) {
            sources[selectedIndex + increment].click();
        }
    }

    const navigateSourceNext = () => {
        navigateSource(1);
    }

    const navigateSourcePrev = () => {
        navigateSource(-1);
    }

    /*
     * ----------------------------------------------------------------
     * UI functions
     * ----------------------------------------------------------------
     */ 

    // Update mailbox title
    const updateMailboxTitle = () => {
        const mailboxTitleView = controller().mailboxTitleView;
       
       if(controller().get('savedSearch')) {
            let item = controller().get('savedSearch');
            mailboxTitleView.value = item.get('displayName') + ( controller().mailboxMessageList().length > 0 ? ` (${controller().mailboxMessageList().length})` : '' )
            try {
                mailboxTitleView.layerStyles.color = item.get('parent').get('color');
            } catch { }
        } else if(controller().get('mailbox').get('role') == 'inbox' || isSpecialMailbox(controller().get('mailbox'))) {
            let item = controller().get('mailbox');
            mailboxTitleView.value = item.get('displayName') + ( controller().mailboxMessageList().length > 0 ? ` (${controller().mailboxMessageList().length})` : '' )
            mailboxTitleView.layerStyles.color = item.get('color');
        } else if(controller().get('mailbox') && !controller().get('search')) {
            let item = controller().get('mailbox');
            mailboxTitleView.value = item.get('displayName') + ( item.get('pinnedThreads') > 0 ? ` (${item.get('pinnedThreads')})` : '' )
            mailboxTitleView.layerStyles.color = item.get('color');
        } else {
            mailboxTitleView.value = ''; 
        }

        mailboxTitleView.computedPropertyDidChange('value').computedPropertyDidChange('layerStyles');
    }

    // Update mailbox filter
    const updateMailboxFilter = () => {
        if(isSpecialMailbox(controller().get('mailbox'))) {
            controller().set('mailboxFilter', controller()._specialFilter);
        } 
    }

    // Update mailbox badges
    const updateMailboxBadges = () => {
        const mailboxes = FastMail.store.getAll(FastMail.classes.Mailbox).filter(mailbox => isSpecialMailbox(mailbox));

        mailboxes.forEach(mailbox => {
            const messages = FastMail.store.getQuery("pinned-"+mailbox.get('id'), FastMail.classes.LocalQuery, {
                Type: FastMail.classes.Message,
                where: function (data) {
                    return data.mailboxIds[mailbox.get('storeKey')] && data.keywords['$flagged'];
                }
            }).get('[]');
            const pinnedThreads = messages.map(x => x.get('thread')).filter((item,index,arr) => { return arr.indexOf(item) == index }).length;
            mailbox.set('pinnedThreads', pinnedThreads);
            mailbox.set('totalThreads',pinnedThreads);
            //console.log(`${mailbox.get('name')} ${mailbox.get('pinnedThreads')}`)
            mailbox.computedPropertyDidChange('badgeProperty');
        });
    }    

    // Update search badges
    const updateSearchBadges = () => {
        getViewsByClass(FastMail.classes.SearchSourceView).forEach(view => {
            view.viewNeedsRedraw();
        })
    }

    /*
    const toggleLabel = (mailboxName) => {
        // Current message
        const messageSK = controller().get('message').get('storeKey');

        // All messages in thread of current message
        const threadMessages = controller().get('thread').get('messages').get('[]');        
        
        // All labels (= mailbox) in thread
        // https://stackoverflow.com/a/43665883
        const currentMailboxSKs = [...new Set(threadMessages.flatMap(message => { 
            return message.get('mailboxes').get('[]').map(mailbox =>
                    { return mailbox.get('storeKey') }
                )
            } ) )
        ];

        // Apply label (add/remove) to current message
        const targetMailbox = FastMail.findMailbox(getAllMailboxes(), mailboxName);
        if(currentMailboxSKs.includes(targetMailbox.get('storeKey'))) {
            controller().actions.remove(messageSK, targetMailbox); 
        } else {
            controller().actions.add(messageSK, targetMailbox);
        }
    }
    */

})();

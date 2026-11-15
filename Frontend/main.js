document.addEventListener('DOMContentLoaded', () => {
      // DOM Elements
      const loginScreen = document.getElementById('screen-login');
      const welcomeScreen = document.getElementById('screen-welcome');
      const chatScreen = document.getElementById('screen-chat');
      const btnCloseChat = document.getElementById('btn-close-chat');
      const btnWelcomeView = document.getElementById('btn-welcome-view');
      const btnChatView = document.getElementById('btn-chat-view');
      const btnStartChat = document.getElementById('btn-start-chat-action');
      const chatInput = document.getElementById('chat-user-input');
      const chatMessagesContainer = document.getElementById('chat-messages-container');
      const promptModal = document.getElementById('passenger-prompt-modal');
      const promptTitle = document.getElementById('prompt-passenger-title');
      const btnContinueChat = document.getElementById('btn-continue-chat');
      const btnNewChat = document.getElementById('btn-new-chat');
      const btnCancelPrompt = document.getElementById('btn-cancel-prompt');
      const initialChatHTML = chatMessagesContainer.innerHTML;
      const PASSENGER_KEY = 'vera-passenger-id';
      const MEMORY_PREFIX = 'vera-working-memory-';
      const SESSION_PREFIX = 'vera-ces-session-';
      const MEMORY_LIMIT = 8;

      let currentPassengerId = String((window.CathayPassenger && window.CathayPassenger.id) || sessionStorage.getItem(PASSENGER_KEY) || '1');
      let pendingPassengerId = null;

      function memoryKey(pid = currentPassengerId) {
        return `${MEMORY_PREFIX}${pid}`;
      }

      function sessionKey(pid = currentPassengerId) {
        return `${SESSION_PREFIX}${pid}`;
      }

      function loadWorkingMemory(pid = currentPassengerId) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(memoryKey(pid)) || '[]');
          if (!Array.isArray(saved)) return [];
          return saved.filter(turn =>
            turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'
          ).slice(-MEMORY_LIMIT);
        } catch (error) {
          return [];
        }
      }

      let workingMemory = [];
      let sessionId = null;
      let requestQueue = Promise.resolve();

      function bindQuickChips() {
        chatMessagesContainer.querySelectorAll('.option-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const promptText = chip.getAttribute('data-prompt') || chip.innerText.trim();
            sendToBackend(promptText);
          });
        });
      }

      function loadPassengerChat(pid, { reset = false } = {}) {
        currentPassengerId = String(pid);
        sessionStorage.setItem(PASSENGER_KEY, currentPassengerId);

        if (reset) {
          sessionStorage.removeItem(memoryKey(currentPassengerId));
          sessionStorage.removeItem(sessionKey(currentPassengerId));
          workingMemory = [];
          sessionId = null;
        } else {
          workingMemory = loadWorkingMemory(currentPassengerId);
          sessionId = sessionStorage.getItem(sessionKey(currentPassengerId));
        }

        chatMessagesContainer.innerHTML = initialChatHTML;
        bindQuickChips();

        let lastUserTurnPrompt = '';
        workingMemory.forEach(turn => {
          if (turn.role === 'user') {
            lastUserTurnPrompt = turn.content;
            appendUserMessage(turn.content, turn.timestamp);
          } else {
            appendAssistantMessage(turn.content, lastUserTurnPrompt);
          }
        });
      }

      function rememberTurn(role, content, timestamp) {
        const turn = { role, content };
        if (role === 'user' && timestamp) turn.timestamp = timestamp;
        workingMemory.push(turn);
        workingMemory = workingMemory.slice(-MEMORY_LIMIT);
        sessionStorage.setItem(memoryKey(currentPassengerId), JSON.stringify(workingMemory));
      }

      // 1. Navigation View Switcher Logic
      window.switchScreenView = function(targetView) {
        if (loginScreen) loginScreen.classList.toggle('hidden', targetView !== 'login');
        if (welcomeScreen) welcomeScreen.classList.toggle('hidden', targetView !== 'welcome');
        if (chatScreen) chatScreen.classList.toggle('hidden', targetView !== 'chat');
        if (btnCloseChat) btnCloseChat.classList.toggle('hidden', targetView === 'login');
        if (promptModal && targetView !== 'login') promptModal.classList.add('hidden');
        if (btnWelcomeView) btnWelcomeView.className = targetView === 'welcome' ? 'demo-btn demo-btn-active' : 'demo-btn demo-btn-inactive';
        if (btnChatView) btnChatView.className = targetView === 'chat' ? 'demo-btn demo-btn-active' : 'demo-btn demo-btn-inactive';
      };

      // Event Listeners for Demo Toolbar & Close (X) Button
      if (btnWelcomeView) btnWelcomeView.addEventListener('click', () => switchScreenView('welcome'));
      if (btnChatView) btnChatView.addEventListener('click', () => switchScreenView('chat'));
      if (btnCloseChat) {
        btnCloseChat.addEventListener('click', () => {
          switchScreenView('login');
        });
      }

      // Demo Passenger Login & Continue/New Prompt
      document.querySelectorAll('.passenger-btn[data-passenger]').forEach(btn => {
        btn.addEventListener('click', () => {
          pendingPassengerId = btn.dataset.passenger;
          if (promptTitle) promptTitle.textContent = `Passenger ${pendingPassengerId}`;
          if (promptModal) promptModal.classList.remove('hidden');
        });
      });

      if (btnContinueChat) {
        btnContinueChat.addEventListener('click', () => {
          if (!pendingPassengerId) return;
          const pid = pendingPassengerId;
          pendingPassengerId = null;
          if (promptModal) promptModal.classList.add('hidden');
          loadPassengerChat(pid, { reset: false });
          switchScreenView('chat');
          scrollToBottom();
        });
      }

      if (btnNewChat) {
        btnNewChat.addEventListener('click', () => {
          if (!pendingPassengerId) return;
          const pid = pendingPassengerId;
          pendingPassengerId = null;
          if (promptModal) promptModal.classList.add('hidden');
          loadPassengerChat(pid, { reset: true });
          switchScreenView('chat');
          chatMessagesContainer.scrollTop = 0;
        });
      }

      if (btnCancelPrompt) {
        btnCancelPrompt.addEventListener('click', () => {
          pendingPassengerId = null;
          if (promptModal) promptModal.classList.add('hidden');
        });
      }

      // 2. Start Chat Action Button
      if (btnStartChat) {
        btnStartChat.addEventListener('click', () => {
          loadPassengerChat(currentPassengerId, { reset: false });
          switchScreenView('chat');
        });
      }

      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('view') === 'chat') {
        loadPassengerChat(currentPassengerId, { reset: false });
        switchScreenView('chat');
        scrollToBottom();
      } else {
        switchScreenView('login');
      }

      async function sendToBackend(text) {
        const sentAt = new Date().toISOString();
        appendUserMessage(text, sentAt);
        const pending = appendAssistantMessage('CARE is thinking...');
        scrollToBottom();

        try {
          const request = requestQueue.then(async () => {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: text, history: workingMemory, session_id: sessionId }),
            });
            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.detail || 'Request failed');
            }
            sessionId = data.session_id;
            sessionStorage.setItem(sessionKey(currentPassengerId), sessionId);
            rememberTurn('user', text, sentAt);
            rememberTurn('assistant', data.reply);
            return data;
          });
          requestQueue = request.catch(() => {});
          const data = await request;
          pending.meta.remove();
          pending.bubble.remove();
          appendAssistantMessage(data.reply, text);
        } catch (error) {
          pending.meta.remove();
          pending.bubble.remove();
          const message = error instanceof TypeError
            ? 'CARE could not answer. Please try again.'
            : (error.message || 'CARE could not answer. Please try again.');
          appendAssistantMessage(message, text);
        }
        scrollToBottom();
      }

      // 3. User Message Sender Implementation
      window.handleUserSendMessage = function() {
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        sendToBackend(text);
      };

      // Helper function to append user messages
      function appendUserMessage(message, timestamp = new Date().toISOString()) {
        const meta = document.createElement('div');
        meta.className = 'message-meta message-meta-sent';
        meta.textContent = `You ${formatMessageTime(timestamp)}`;

        const userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble-sent';
        userBubble.textContent = message;
        chatMessagesContainer.appendChild(meta);
        chatMessagesContainer.appendChild(userBubble);
      }

      function formatMessageTime(timestamp) {
        return new Date(timestamp)
          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      }

      // Cathay Brushwing SVG icon used for reference/citation chips
      const CATHAY_BRUSHWING_SVG = `<svg viewBox="0 0 24 24" fill="#006564" xmlns="http://www.w3.org/2000/svg"><path d="M21.5 5.2c-4.2 1.2-8.5 4.8-12.2 10.1-2.4 3.4-4.2 4.9-6.3 5.4 1.6-.7 3.4-2.2 5.2-4.6 4.2-5.3 8.4-8.8 13.3-10.9z"/><path d="M19.2 7.8c-3.4 1.4-6.8 4.7-9.7 9-1.4 2.1-2.8 3.3-4.2 3.8 1-.5 2.3-1.4 3.7-3.3 3.3-4.3 6.6-7.5 10.2-9.5z"/></svg>`;

      // Helper function to extract option lists from raw markdown message before rendering
      function extractOptionsFromMessage(text) {
        if (!text) return { hasOptions: false, options: [], prose: text };

        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const options = [];
        const proseLines = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Explicit intro line ending with ':' is prose
          if (line.endsWith(':')) {
            proseLines.push(line);
            continue;
          }

          // Pattern 1: Numbered or bulleted item: '1. Title' or '* Title' or '- Title'
          const isBulletOrNum = /^(\d+[\.\)]|[\*\-\+])\s+(.+)$/.exec(line);
          // Pattern 2: Markdown link: '[Title](http...)' or 'Title[↗](http...)' or '[Title[↗]](http...)'
          const isLinkPattern = /^\[?([^\]\n]+?)\]?\s*(?:\[?↗\]?)?\s*\((https?:\/\/[^\s\)]+)\)$/.exec(line);
          // Pattern 3: Line ending with external arrow: 'Title[↗]' or 'Title ↗'
          const isArrowLine = /^\[?([^\]\n]+?)\]?\s*\[?↗\]?$/.exec(line);

          let candidate = null;
          if (isBulletOrNum) {
            candidate = isBulletOrNum[2].replace(/\[?↗\]?$/, '').replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').trim();
          } else if (isLinkPattern) {
            candidate = isLinkPattern[1].replace(/\[?↗\]?$/, '').trim();
          } else if (isArrowLine && line.includes('↗')) {
            candidate = isArrowLine[1].replace(/\[?↗\]?$/, '').trim();
          } else if (options.length > 0) {
            // Consecutive short lines without sentence punctuation are options
            if (line.length <= 70 && !line.endsWith('.') && !line.endsWith('!') && !line.endsWith('?')) {
              candidate = line.trim();
            }
          }

          // Filter out candidates that are full sentences or paragraphs
          if (candidate && candidate.length > 0 && candidate.length <= 80 && !candidate.endsWith('.') && !candidate.includes('Cathay Pacific') && !candidate.includes('Customer Care')) {
            options.push(candidate);
          } else {
            proseLines.push(line);
          }
        }

        if (options.length < 2) {
          return { hasOptions: false, options: [], prose: text };
        }
        return { hasOptions: true, options, prose: proseLines.join('\n\n') };
      }

      // Helper function to format assistant bubble with stacked buttons or navigation
      function formatAssistantBubble(botBubble, userPrompt = '', extractedOptions = []) {
        const promptText = (userPrompt || '').toLowerCase();
        const replyText = (botBubble.textContent || '').toLowerCase();

        // 1. Strict Mutually Exclusive Intent Detection for Navigation (Plan vs Survey)
        let targetNav = null; // 'plan' | 'survey' | null
        if (promptText.includes('plan') || promptText.includes('itinerary') || promptText.includes('schedule')) {
          targetNav = 'plan';
        } else if (promptText.includes('question') || promptText.includes('survey') || promptText.includes('assess') || promptText.includes('meda')) {
          targetNav = 'survey';
        } else if (replyText.includes('plan.html') || replyText.includes('assistance plan') || replyText.includes('personalized plan')) {
          targetNav = 'plan';
        } else if (replyText.includes('questionnaire.html') || replyText.includes('survey.html') || replyText.includes('questionnaire') || replyText.includes('assessment')) {
          targetNav = 'survey';
        }

        let buttonGroup = null;

        if (targetNav === 'plan') {
          buttonGroup = document.createElement('div');
          buttonGroup.className = 'chat-action-button-group';

          const btnRow = document.createElement('div');
          btnRow.className = 'chat-action-btn-row';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chat-action-btn';
          btn.setAttribute('data-query', 'View Personalized Assistance Plan');
          btn.innerHTML = '<span class="chat-action-btn-label">View Personalized Assistance Plan</span>';
          btn.addEventListener('click', () => {
            window.location.assign('./plan.html');
          });
          btnRow.appendChild(btn);
          buttonGroup.appendChild(btnRow);
        } else if (targetNav === 'survey') {
          buttonGroup = document.createElement('div');
          buttonGroup.className = 'chat-action-button-group';

          const btnRow = document.createElement('div');
          btnRow.className = 'chat-action-btn-row';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chat-action-btn';
          btn.setAttribute('data-query', 'Take Accessibility Questionnaire');
          btn.innerHTML = '<span class="chat-action-btn-label">Take Accessibility Needs Questionnaire</span>';
          btn.addEventListener('click', () => {
            window.location.assign('./questionnaire.html');
          });
          btnRow.appendChild(btn);
          buttonGroup.appendChild(btnRow);
        } else if (extractedOptions && extractedOptions.length >= 2) {
          // 2. Regulation / Service Options buttons (from extracted message options)
          buttonGroup = document.createElement('div');
          buttonGroup.className = 'chat-action-button-group';

          extractedOptions.forEach(title => {
            const cleanTitle = title.replace(/\s*\[?↗\]?\s*$/g, '').trim();
            const btnRow = document.createElement('div');
            btnRow.className = 'chat-action-btn-row';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-action-btn';
            btn.setAttribute('data-query', cleanTitle);

            const label = document.createElement('span');
            label.className = 'chat-action-btn-label';
            label.textContent = cleanTitle;
            btn.appendChild(label);

            // On click: NEVER open new tab, send as message to get detailed explanation
            btn.addEventListener('click', () => {
              sendToBackend(cleanTitle);
            });

            btnRow.appendChild(btn);
            buttonGroup.appendChild(btnRow);
          });
        } else {
          // Fallback: Detect any remaining rendered lists (ol, ul)
          const lists = Array.from(botBubble.querySelectorAll('ol, ul'));
          for (const list of lists) {
            const items = Array.from(list.querySelectorAll('li'));
            if (items.length < 2) continue;

            const isOptionList = items.every(li => {
              const text = li.textContent.trim();
              return text.length > 0 && text.length <= 90;
            });

            if (isOptionList) {
              buttonGroup = document.createElement('div');
              buttonGroup.className = 'chat-action-button-group';

              items.forEach(li => {
                const link = li.querySelector('a');
                let title = (link ? link.textContent : li.textContent).trim();
                title = title.replace(/\s*\[?↗\]?\s*$/g, '').trim();

                const btnRow = document.createElement('div');
                btnRow.className = 'chat-action-btn-row';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'chat-action-btn';
                btn.setAttribute('data-query', title);

                const label = document.createElement('span');
                label.className = 'chat-action-btn-label';
                label.textContent = title;
                btn.appendChild(label);

                btn.addEventListener('click', () => {
                  sendToBackend(title);
                });

                btnRow.appendChild(btn);
                buttonGroup.appendChild(btnRow);
              });

              list.remove();
              break;
            }
          }
        }

        // 3. Format standalone reference links at the bottom as Cathay citation chips
        const paragraphs = Array.from(botBubble.querySelectorAll('p'));
        paragraphs.forEach(p => {
          const links = Array.from(p.querySelectorAll('a[href]'));
          // If paragraph consists only of links and whitespace/br tags
          if (links.length > 0) {
            const clone = p.cloneNode(true);
            clone.querySelectorAll('a').forEach(a => a.remove());
            const remainingText = clone.textContent.replace(/\s+/g, '').trim();
            if (remainingText === '' || remainingText === '[↗]' || remainingText === '↗') {
              const chipsContainer = document.createElement('div');
              chipsContainer.className = 'cathay-citation-chips';
              links.forEach(a => {
                const href = a.getAttribute('href');
                let rawLabel = a.textContent.replace(/\s*\[?↗\]?\s*$/g, '').trim();
                const chip = document.createElement('a');
                chip.href = href;
                chip.target = '_blank';
                chip.rel = 'noopener noreferrer';
                chip.className = 'cathay-citation-chip';
                chip.title = rawLabel;
                chip.innerHTML = `${CATHAY_BRUSHWING_SVG}<span>${rawLabel}</span>`;
                chipsContainer.appendChild(chip);
              });
              p.replaceWith(chipsContainer);
            }
          }
        });

        // 4. Keep internal app links in same window, external links in new tab
        botBubble.querySelectorAll('a[href]').forEach(a => {
          const href = (a.getAttribute('href') || '').trim();
          if (href.includes('plan.html')) {
            a.removeAttribute('target');
            a.href = './plan.html';
          } else if (href.includes('questionnaire.html') || href.includes('survey.html')) {
            a.removeAttribute('target');
            a.href = './questionnaire.html';
          } else {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          }
        });

        // 5. Wrap text and attach action buttons if any
        if (buttonGroup && buttonGroup.children.length > 0) {
          botBubble.classList.add('has-action-buttons');
          const textWrapper = document.createElement('div');
          textWrapper.className = 'chat-bubble-text';
          while (botBubble.firstChild) {
            textWrapper.appendChild(botBubble.firstChild);
          }
          botBubble.appendChild(textWrapper);
          botBubble.appendChild(buttonGroup);
        }
      }

      // Helper function to append assistant messages
      function appendAssistantMessage(message, userPrompt = '') {
        const timeString = formatMessageTime(new Date().toISOString());
        
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = "CARE " + timeString;
        
        const botBubble = document.createElement('div');
        botBubble.className = 'chat-bubble-received';

        // Extract options from raw message first if any
        const { hasOptions, options, prose } = extractOptionsFromMessage(message);
        const textToRender = hasOptions ? prose : message;

        if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
          console.error('Markdown rendering unavailable: Marked or DOMPurify failed to load.');
          botBubble.textContent = textToRender;
        } else {
          botBubble.innerHTML = DOMPurify.sanitize(marked.parse(textToRender, { async: false, breaks: true }), {
            ALLOWED_TAGS: [
              'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em',
              'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr',
              'table', 'thead', 'tbody', 'tr', 'th', 'td',
            ],
            ALLOWED_ATTR: ['href', 'title', 'start'],
          });
          formatAssistantBubble(botBubble, userPrompt, hasOptions ? options : []);
        }

        chatMessagesContainer.appendChild(meta);
        chatMessagesContainer.appendChild(botBubble);
        return { meta, bubble: botBubble };
      }

      // Scroll helper
      function scrollToBottom() {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      }
    });
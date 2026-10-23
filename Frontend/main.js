document.addEventListener('DOMContentLoaded', () => {
      // DOM Elements
      const welcomeScreen = document.getElementById('screen-welcome');
      const chatScreen = document.getElementById('screen-chat');
      const btnWelcomeView = document.getElementById('btn-welcome-view');
      const btnChatView = document.getElementById('btn-chat-view');
      const btnStartChat = document.getElementById('btn-start-chat-action');
      const chatInput = document.getElementById('chat-user-input');
      const chatMessagesContainer = document.getElementById('chat-messages-container');
      const optionChips = document.querySelectorAll('.option-chip');
      const MEMORY_KEY = 'vera-working-memory';
      const MEMORY_LIMIT = 8;

      function loadWorkingMemory() {
        try {
          const saved = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || '[]');
          if (!Array.isArray(saved)) return [];
          return saved.filter(turn =>
            turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string'
          ).slice(-MEMORY_LIMIT);
        } catch (error) {
          return [];
        }
      }

      let workingMemory = loadWorkingMemory();
      workingMemory.forEach(turn => {
        if (turn.role === 'user') appendUserMessage(turn.content);
        else appendAssistantMessage(turn.content);
      });

      function rememberTurn(role, content) {
        workingMemory.push({ role, content });
        workingMemory = workingMemory.slice(-MEMORY_LIMIT);
        sessionStorage.setItem(MEMORY_KEY, JSON.stringify(workingMemory));
      }

      // 1. Navigation View Switcher Logic
      window.switchScreenView = function(targetView) {
        if (targetView === 'welcome') {
          welcomeScreen.classList.remove('hidden');
          chatScreen.classList.add('hidden');
          btnWelcomeView.className = 'demo-btn demo-btn-active';
          btnChatView.className = 'demo-btn demo-btn-inactive';
        } else {
          welcomeScreen.classList.add('hidden');
          chatScreen.classList.remove('hidden');
          btnChatView.className = 'demo-btn demo-btn-active';
          btnWelcomeView.className = 'demo-btn demo-btn-inactive';
        }
      };

      // Event Listeners for Demo Toolbar
      btnWelcomeView.addEventListener('click', () => switchScreenView('welcome'));
      btnChatView.addEventListener('click', () => switchScreenView('chat'));

      // 2. Start Chat Action Button
      btnStartChat.addEventListener('click', () => {
        switchScreenView('chat');
      });

      async function sendToBackend(text) {
        appendUserMessage(text);
        const pending = appendAssistantMessage('Vera is thinking...');
        scrollToBottom();

        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, history: workingMemory }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.detail || 'Request failed');
          }
          pending.meta.remove();
          pending.bubble.remove();
          rememberTurn('user', text);
          rememberTurn('assistant', data.reply);
          appendAssistantMessage(data.reply);
        } catch (error) {
          pending.meta.remove();
          pending.bubble.remove();
          const message = error instanceof TypeError
            ? 'Vera could not answer. Is the backend and Ollama running?'
            : (error.message || 'Vera could not answer. Is the backend and Ollama running?');
          appendAssistantMessage(message);
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

      // 4. Quick Action Chip Click Handler
      optionChips.forEach(chip => {
        chip.addEventListener('click', () => {
          const promptText = chip.getAttribute('data-prompt') || chip.innerText.trim();
          sendToBackend(promptText);
        });
      });

      // Helper function to append user messages
      function appendUserMessage(message) {
        const userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble-sent';
        userBubble.textContent = message;
        chatMessagesContainer.appendChild(userBubble);
      }

      // Helper function to append assistant messages
      function appendAssistantMessage(message) {
        const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
        
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = `Vera ${timeString}`;
        
        const botBubble = document.createElement('div');
        botBubble.className = 'chat-bubble-received';
        botBubble.textContent = message;

        chatMessagesContainer.appendChild(meta);
        chatMessagesContainer.appendChild(botBubble);
        return { meta, bubble: botBubble };
      }

      // Scroll helper
      function scrollToBottom() {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      }
    });
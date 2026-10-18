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

      // 3. User Message Sender Implementation
      window.handleUserSendMessage = function() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Append User Bubble
        appendUserMessage(text);
        chatInput.value = '';

        // Auto Scroll to Bottom
        scrollToBottom();

        // Simulate Assistant Response
        setTimeout(() => {
          appendAssistantMessage("Thank you for reaching out! I'm processing your request regarding: \"" + text + "\"");
          scrollToBottom();
        }, 800);
      };

      // 4. Quick Action Chip Click Handler
      optionChips.forEach(chip => {
        chip.addEventListener('click', () => {
          const promptText = chip.getAttribute('data-prompt') || chip.innerText.trim();
          appendUserMessage(promptText);
          scrollToBottom();

          // Response Simulation
          setTimeout(() => {
            appendAssistantMessage("I can certainly assist you with that. Please provide your booking reference (PNR) or ticket number to proceed.");
            scrollToBottom();
          }, 800);
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
      }

      // Scroll helper
      function scrollToBottom() {
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
      }
    });
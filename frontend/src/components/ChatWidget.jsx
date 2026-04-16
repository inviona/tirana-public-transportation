import { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Bot, User, Sparkles } from 'lucide-react';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      text: 'Mirëmengjes! 👋 Unë jam asistenti juaj i transportit publik në Tiranë. Si mund t\'ju ndihmoj sot?\n\nGood morning! I\'m your Tirana transit assistant. How can I help you today?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      role: 'user',
      text: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage.text,
          sessionId,
        }),
      });

      const data = await res.json();
      
      if (data.error && !data.reply) {
        throw new Error(data.error);
      }

      const assistantMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: data.reply,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: 'Ndjesë, pati një problem. Ju lutem provoni përsëri.\n\nSorry, there was a problem. Please try again.',
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setIsLoading(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = async () => {
    await fetch('http://localhost:3001/api/chat/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    setMessages([
      {
        id: 1,
        role: 'assistant',
        text: 'Mirëmbrema! 👋 Unë jam asistenti juaj i transportit publik në Tiranë. Si mund t\'ju ndihmoj?\n\nGood evening! I\'m your Tirana transit assistant. How can I help?',
      },
    ]);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={styles.fabButton}
        title="Chat with Transit Assistant"
      >
        <MessageCircle size={24} color="#fff" />
        <span style={styles.fabBadge}>AI</span>
      </button>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.avatar}>
            <Bot size={20} color="#fff" />
          </div>
          <div>
            <div style={styles.headerTitle}>Tirana Transit Assistant</div>
            <div style={styles.headerSubtitle}>
              <Sparkles size={12} style={{ marginRight: 4 }} />
              Powered by AI
            </div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button onClick={clearChat} style={styles.clearBtn} title="Clear chat">
            Clear
          </button>
          <button onClick={() => setIsOpen(false)} style={styles.closeBtn}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div style={styles.messages}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...styles.messageRow,
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            {msg.role === 'assistant' && (
              <div style={styles.assistantAvatar}>
                <Bot size={14} color="#fff" />
              </div>
            )}
            <div
              style={{
                ...styles.messageBubble,
                ...(msg.role === 'user' ? styles.userBubble : styles.assistantBubble),
              }}
            >
              {msg.text.split('\n').map((line, i) => (
                <span key={i}>
                  {line}
                  {i < msg.text.split('\n').length - 1 && <br />}
                </span>
              ))}
            </div>
            {msg.role === 'user' && (
              <div style={styles.userAvatar}>
                <User size={14} color="#fff" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div style={styles.messageRow}>
            <div style={styles.assistantAvatar}>
              <Bot size={14} color="#fff" />
            </div>
            <div style={styles.typingIndicator}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputArea}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Pyetni për rrugët, oraret, ose ndihmë..."
          style={styles.input}
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          style={{
            ...styles.sendBtn,
            opacity: !input.trim() || isLoading ? 0.5 : 1,
          }}
        >
          <Send size={18} />
        </button>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .typing-dot {
          animation: pulse 1.4s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        .chat-fab:hover {
          transform: scale(1.1);
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 380,
    height: 520,
    background: 'rgba(20, 20, 30, 0.75)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderRadius: 20,
    border: '1px solid rgba(255, 255, 255, 0.15)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 60px rgba(207, 10, 44, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    zIndex: 9998,
    fontFamily: "'DM Sans', sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    background: 'rgba(207, 10, 44, 0.3)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #cf0a2c, #8b0000)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(207, 10, 44, 0.4)',
  },
  headerTitle: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    fontFamily: "'Syne', sans-serif",
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    marginTop: 2,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  clearBtn: {
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: 8,
    padding: '6px 10px',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  closeBtn: {
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: 8,
    padding: 6,
    color: 'rgba(255, 255, 255, 0.7)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  messageRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #cf0a2c, #8b0000)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: 'rgba(255, 255, 255, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  messageBubble: {
    maxWidth: '75%',
    padding: '10px 14px',
    borderRadius: 16,
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  userBubble: {
    background: 'linear-gradient(135deg, #cf0a2c, #a00020)',
    color: '#fff',
    borderBottomRightRadius: 4,
    boxShadow: '0 2px 8px rgba(207, 10, 44, 0.3)',
  },
  assistantBubble: {
    background: 'rgba(255, 255, 255, 0.12)',
    color: '#f0f0f0',
    borderBottomLeftRadius: 4,
    backdropFilter: 'blur(8px)',
  },
  typingIndicator: {
    display: 'flex',
    gap: 4,
    padding: '12px 16px',
    background: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
  },
  inputArea: {
    display: 'flex',
    gap: 8,
    padding: 16,
    background: 'rgba(0, 0, 0, 0.2)',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  },
  input: {
    flex: 1,
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    padding: '10px 14px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
  },
  sendBtn: {
    width: 44,
    height: 44,
    background: 'linear-gradient(135deg, #cf0a2c, #a00020)',
    border: 'none',
    borderRadius: 12,
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    boxShadow: '0 4px 12px rgba(207, 10, 44, 0.3)',
  },
  fabButton: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #cf0a2c, #8b0000)',
    border: 'none',
    boxShadow: '0 4px 20px rgba(207, 10, 44, 0.5), 0 0 40px rgba(207, 10, 44, 0.3)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
    transition: 'all 0.3s ease',
    className: 'chat-fab',
  },
  fabBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    background: '#e8b84b',
    color: '#000',
    fontSize: 9,
    fontWeight: 700,
    padding: '2px 5px',
    borderRadius: 8,
    letterSpacing: 0.5,
  },
};

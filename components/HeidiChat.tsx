import { useHeidiChat, UseHeidiChatOptions, Message, ToolEvent, ActionEvent } from '../lib/useHeidiChat';

export type { Message, ToolEvent, ActionEvent };

interface HeidiChatProps extends UseHeidiChatOptions {
  className?: string;
}

export default function HeidiChat(props: HeidiChatProps) {
  const { className = 'h-full' } = props;
  const {
    messages,
    input,
    setInput,
    isLoading,
    error,
    connectionOk,
    model,
    settingsOpen,
    setSettingsOpen,
    secretDraft,
    setSecretDraft,
    saveServiceSecret,
    handleSubmit,
    handleKeyDown,
    stopStreaming,
    resolveAction,
    scrollRef,
    inputRef,
  } = useHeidiChat(props);

  return (
    <div className={`flex flex-col bg-[#0f0f17] text-gray-100 ${className}`}>
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#0f0f17]/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-sm font-bold">
            H
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Heidi</h1>
            <p className="text-[11px] text-gray-500">{model ? model : 'connecting...'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {connectionOk !== null && (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionOk ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              {connectionOk ? 'Online' : 'Offline'}
            </span>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-[#16161f] border border-white/[0.08] rounded-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-gray-200 mb-1">Connection settings</h2>
            <p className="text-[11px] text-gray-500 mb-4">
              Approving or rejecting a ProtoForge-escalated action requires a service secret (
              <code className="text-gray-400">HYDI_SERVICE_SECRET</code>). Stored only in this
              browser (localStorage) — never sent anywhere but this page&apos;s own API.
            </p>
            <input
              type="password"
              value={secretDraft}
              onChange={e => setSecretDraft(e.target.value)}
              placeholder="HYDI_SERVICE_SECRET"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-violet-500/40 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveServiceSecret}
                className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll min-h-0">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 select-none">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20 flex items-center justify-center">
                <span className="text-3xl">H</span>
              </div>
              <div className="text-center">
                <h2 className="text-lg font-medium text-gray-300">What can I help with?</h2>
                <p className="text-sm text-gray-600 mt-1 max-w-md">
                  Ask me about system status, run tasks, manage revenue streams, or just chat.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {['System status', 'Show revenue streams', 'Run health check', 'What can you do?'].map(
                  q => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="px-3 py-1.5 text-xs text-gray-400 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-full transition-all hover:text-gray-200"
                    >
                      {q}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className="msg-enter mb-5">
              {msg.role === 'user' ? (
                <UserBubble content={msg.content} />
              ) : (
                <AssistantBubble
                  content={msg.content}
                  isStreaming={!!msg.isStreaming}
                  tools={msg.tools}
                  actions={msg.actions}
                  onResolveAction={(actionId, decision) => resolveAction(msg.id, actionId, decision)}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-2 border-t border-white/[0.06] bg-red-500/10 text-red-300 text-xs text-center">
          {error}
        </div>
      )}

      <div className="border-t border-white/[0.06] bg-[#0f0f17]/80 backdrop-blur-sm shrink-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-4 py-3">
          <div className="relative flex items-end bg-white/[0.04] border border-white/[0.08] rounded-2xl focus-within:border-violet-500/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Heidi..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 px-4 py-3 resize-none outline-none max-h-36 overflow-y-auto"
              style={{
                height: 'auto',
                minHeight: '44px',
                maxHeight: '144px',
              }}
              onInput={e => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 144) + 'px';
              }}
              disabled={isLoading}
              autoFocus
            />
            <div className="px-2 pb-2 flex items-center gap-1">
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-gray-400 hover:text-gray-200 transition-colors"
                  title="Stop generating"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:hover:bg-violet-600 text-white transition-colors"
                  title="Send message"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-700 text-center mt-2">Shift+Enter for new line</p>
        </form>
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-violet-600/20 border border-violet-500/20 rounded-2xl rounded-br-md px-4 py-2.5">
        <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  isStreaming,
  tools,
  actions,
  onResolveAction,
}: {
  content: string;
  isStreaming: boolean;
  tools?: ToolEvent[];
  actions?: ActionEvent[];
  onResolveAction?: (_actionId: string, _decision: 'approve' | 'reject') => void;
}) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center text-[11px] font-bold text-violet-300 mt-0.5">
        H
      </div>
      <div className="min-w-0 flex-1">
        {tools && tools.length > 0 && (
          <div className="mb-2 space-y-1">
            {tools.map((tool, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[11px] text-gray-500 bg-white/[0.02] border border-white/[0.04] rounded-lg px-2.5 py-1.5"
              >
                <span className="text-violet-400/70">
                  {tool.status === 'completed'
                    ? '\u2713'
                    : tool.status === 'failed'
                    ? '\u2717'
                    : '\u25CB'}
                </span>
                <span className="font-mono">{tool.type}</span>
                {tool.error && <span className="text-red-400/70 truncate ml-auto">{tool.error}</span>}
              </div>
            ))}
          </div>
        )}

        {actions && actions.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {actions.map((action, i) => (
              <div
                key={action.actionId || i}
                className={`text-[11px] rounded-lg px-2.5 py-2 border ${
                  action.status === 'pending_approval'
                    ? 'bg-amber-400/[0.06] border-amber-400/20'
                    : action.status === 'failed'
                    ? 'bg-red-400/[0.04] border-red-400/10'
                    : 'bg-white/[0.02] border-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2 text-gray-400">
                  <span
                    className={
                      action.status === 'completed'
                        ? 'text-emerald-400/70'
                        : action.status === 'failed'
                        ? 'text-red-400/70'
                        : 'text-amber-400/70'
                    }
                  >
                    {action.status === 'completed'
                      ? '\u2713'
                      : action.status === 'failed'
                      ? '\u2717'
                      : '\u23F3'}
                  </span>
                  <span className="font-mono">{action.type}</span>
                  <span className="ml-auto text-gray-600">
                    {action.status === 'pending_approval' ? 'needs your approval' : action.status}
                  </span>
                </div>
                {action.error && <div className="text-red-400/70 mt-1 truncate">{action.error}</div>}
                {action.status === 'pending_approval' && action.actionId && onResolveAction && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => onResolveAction(action.actionId!, 'approve')}
                      disabled={action.resolving}
                      className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/20 disabled:opacity-40 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onResolveAction(action.actionId!, 'reject')}
                      disabled={action.resolving}
                      className="px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 border border-white/[0.06] disabled:opacity-40 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {content ? (
          <div
            className={`text-sm text-gray-300 whitespace-pre-wrap leading-relaxed ${
              isStreaming ? 'streaming-cursor' : ''
            }`}
          >
            {content}
          </div>
        ) : isStreaming ? (
          <div className="dot-pulse flex gap-1 py-2">
            <span className="w-2 h-2 rounded-full bg-violet-400/60" />
            <span className="w-2 h-2 rounded-full bg-violet-400/60" />
            <span className="w-2 h-2 rounded-full bg-violet-400/60" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

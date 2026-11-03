export const LogViewer = ({ logs }: { logs: any[] }) => {
    return (
        <div className="log-container">
            {logs.slice().reverse().map((log, index) => {
                const sourceClass = log.origin === 'RUST' ? 'rust' : log.origin === 'UI' ? 'ui' : 'python';
                const uiPrefix = "UI COMPONENT WARNING:";
                const hasUiPrefix = log.origin === 'UI' && log.message.startsWith(uiPrefix);
                const messageBody = hasUiPrefix ? log.message.slice(uiPrefix.length).trim() : log.message;

                return (
                    <div key={index} className={`log-line ${sourceClass}`}>
                        <div className="log-row">
                            <span className="log-timestamp">[{log.timestamp}]</span>
                            <span className={`log-source-pill ${sourceClass}`}>{log.origin}</span>
                        </div>
                        {hasUiPrefix ? (
                            <div className="log-message">
                                <span className="log-message-prefix">{uiPrefix}</span>
                                <span className="log-message-text">{messageBody}</span>
                            </div>
                        ) : (
                            <div className="log-body">{messageBody}</div>
                        )}
                    </div>
                );
            })}
            {logs.length === 0 && <p className="log-empty">No logs yet...</p>}
        </div>
    )
}
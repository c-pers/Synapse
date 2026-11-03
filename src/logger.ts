export interface LogRecord {
    message: string;
    origin: "RUST" | "PYTHON" | "UI";
    timestamp: string;
}

export class SynapseLogger {
    private logs: LogRecord[] = [];
    private listeners: Array<() => void> = [];

    add(text: string, source: "RUST" | "PYTHON" | "UI") {
        const newLog: LogRecord = {
            message: text,
            origin: source,
            timestamp: new Date().toLocaleTimeString(),
        };

        this.logs.push(newLog);
        this.notifyListeners();
    }

    getLogsPerSource(source: "RUST" | "PYTHON" | "UI"): LogRecord[] {
        return this.logs.filter(log => log.origin === source);
    }

    getAllLogs(): LogRecord[] {
        return [...this.logs];
    }

    clear() {
        this.logs = [];
        this.notifyListeners();
    }

    subscribe(listener: () => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(listener => listener());
    }
}

export const logger = new SynapseLogger();
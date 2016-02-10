import { window } from 'vscode';

export enum LogLevel {
    none,
    error,
    warn,
    info,
    log
}

export interface ILogger {
    setLogLevel(level: LogLevel): void;
    error(message: string): void;
    warn(message: string): void;
    log(message: string): void;
    info(message: string): void;
}

export class Logger implements ILogger {
    private level: LogLevel;
    private prefix: string;

    public constructor(prefix?: string, level?: LogLevel) {
        this.prefix = prefix || 'VSCODE-HLINT'
        this.level = level || LogLevel.error;
    }

    public setLogLevel(level: LogLevel): void {
        this.level = level;
    }

    public log(message: string): void {
        if (this.level >= LogLevel.log) {
            console.log(`${this.prefix} ${message}`);
        }
    }

    public info(message: string): void {
        if (this.level >= LogLevel.info) {
            console.info(`${this.prefix} ${message}`);
        }
    }

    public warn(message: string): void {
        if (this.level >= LogLevel.warn) {
            console.warn(`${this.prefix} ${message}`);
        }
    }

    public error(message: string): void {
        if (this.level >= LogLevel.error) {
            console.error(`${this.prefix} ${message}`);
            window.showErrorMessage(message);
        }
    }
}
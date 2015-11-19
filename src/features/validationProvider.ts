'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;
import { NodeStringDecoder, StringDecoder } from 'string_decoder';

import * as vscode from 'vscode';

import { ThrottledDelayer } from './utils/async';

export class LineDecoder {
	private stringDecoder: NodeStringDecoder;
	private remaining: string;

	constructor(encoding: string = 'utf8') {
		this.stringDecoder = new StringDecoder(encoding);
		this.remaining = null;
	}

	public write(buffer: NodeBuffer): string[] {
		var result: string[] = [];
		var value = this.remaining
			? this.remaining + this.stringDecoder.write(buffer)
			: this.stringDecoder.write(buffer);

		if (value.length < 1) {
			return result;
		}
		var start = 0;
		var ch: number;
		while (start < value.length && ((ch = value.charCodeAt(start)) === 13 || ch === 10)) {
			start++;
		}
		var idx = start;
		while (idx < value.length) {
			ch = value.charCodeAt(idx);
			if (ch === 13 || ch === 10) {
				result.push(value.substring(start, idx));
				idx++;
				while (idx < value.length && ((ch = value.charCodeAt(idx)) === 13 || ch === 10)) {
					idx++;
				}
				start = idx;
			} else {
				idx++;
			}
		}
		this.remaining = start < value.length ? value.substr(start) : null;
		return result;
	}

	public end(): string {
		return this.remaining;
	}
}

export default class HaskellValidationProvider {

	private static FileArgs: string[] = ['--json', '--hint=Default', '--hint=Dollar', '--hint=Generalise'];

	private executable: string;
	private executableNotFound: boolean;

	private documentListener: vscode.Disposable;
	private diagnosticCollection: vscode.DiagnosticCollection;
	private delayers: { [key: string]: ThrottledDelayer<void> };

	constructor() {
		this.executable = null;
		this.executableNotFound = false;
	}

	public activate(subscriptions: vscode.Disposable[]) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection();
		subscriptions.push(this);
		vscode.workspace.onDidChangeConfiguration(this.loadConfiguration, this, subscriptions);
		this.loadConfiguration();

		vscode.workspace.onDidOpenTextDocument(this.triggerValidate, this, subscriptions);
		vscode.workspace.onDidCloseTextDocument((textDocument)=> {
			this.diagnosticCollection.delete(textDocument.uri);
			delete this.delayers[textDocument.uri.toString()];
		}, null, subscriptions);

		// Validate all open haskell documents
		vscode.workspace.textDocuments.forEach(this.triggerValidate, this);
	}

	public dispose(): void {
		this.diagnosticCollection.clear();
		this.diagnosticCollection.dispose();
	}

	private loadConfiguration(): void {
		let section = vscode.workspace.getConfiguration('hlint');
		let oldExecutable = this.executable;
		if (section) {
			this.executable = section.get<string>('validate.executablePath', null);
		}
		this.delayers = Object.create(null);
		if (this.executableNotFound) {
			this.executableNotFound = oldExecutable === this.executable;
		}
		if (this.documentListener) {
			this.documentListener.dispose();
		}
		
		this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerValidate, this);
		// Configuration has changed. Reevaluate all documents.
		vscode.workspace.textDocuments.forEach(this.triggerValidate, this);
	}

	private triggerValidate(textDocument: vscode.TextDocument): void {
		if (textDocument.languageId !== 'haskell' || this.executableNotFound) {
			return;
		}
		let key = textDocument.uri.toString();
		let delayer = this.delayers[key];
		if (!delayer) {
			delayer = new ThrottledDelayer<void>(0);
			this.delayers[key];
		}
		delayer.trigger(() => this.doValidate(textDocument) );
	}

	private doValidate(textDocument: vscode.TextDocument): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let executable = this.executable || 'hlint';
			let filePath = textDocument.fileName;
			let decoder = new LineDecoder();
			let decoded = []
			let diagnostics: vscode.Diagnostic[] = [];
			let processLine = (info: any) => {
				if (info) {
					let message = info.hint + " Suggestion: " + info.from + " ==> " + info.to;
					let severity = info.severity.toLowerCase() === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
					let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
						new vscode.Range(info.startLine - 1, info.startColumn - 1, info.endLine - 1, info.endColumn - 1), message, severity
					)
					diagnostics.push(diagnostic);
				}
			}

			let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;
			let args: string[];
			
			args = HaskellValidationProvider.FileArgs.slice(0);
			args.push(textDocument.fileName);
			
			let childProcess = cp.spawn(executable, args, options);
			childProcess.on('error', (error: Error) => {
				if (this.executableNotFound) {
					resolve();
					return;
				}
				let message: string = null;
				if ((<any>error).code === 'ENOENT') {
					message = `Cannot validate the haskell file. The hlint program was not found. Use the 'haskell.validate.executablePath' setting to configure the location of 'hlint'`;
				} else {
					message = error.message ? error.message : `Failed to run hlint using path: ${executable}. Reason is unknown.`;
				}
				vscode.window.showInformationMessage(message);
				this.executableNotFound = true;
				resolve();
			});
			if (childProcess.pid) {
				childProcess.stdout.on('data', (data: Buffer) => {
					decoded = decoded.concat(decoder.write(data));
				});
				childProcess.stdout.on('end', () => {
					decoded = decoded.concat(decoder.end());
					JSON.parse(decoded.join('')).forEach(processLine);
					this.diagnosticCollection.set(textDocument.uri, diagnostics);
					resolve();
				});
			} else {
				resolve();
			}
		});
	}
}
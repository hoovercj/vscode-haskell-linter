'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;
import { NodeStringDecoder, StringDecoder } from 'string_decoder';

import * as vscode from 'vscode';

import { ThrottledDelayer } from './utils/async';

export interface LintItem {
	module:string;
	decl:string;
	severity:string;
	hint:string;
    file:string;
	startLine:number;
	startColumn:number;
	endLine:number;
	endColumn:number;
	from:string;
	to:string;
	note:string[]
}

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

enum RunTrigger {
	onSave,
	onType
}

namespace RunTrigger {
	export let strings = {
		onSave: 'onSave',
		onType: 'onType'
	}
	export let from = function(value: string): RunTrigger {
		if (value === 'onType') {
			return RunTrigger.onType;
		} else {
			return RunTrigger.onSave;
		}
	}
}

export default class HaskellLintingProvider implements vscode.CodeActionProvider {

	private static FileArgs: string[] = ['--json'];
	private static BufferArgs: string[] = ['-', '--json'];
	private trigger: RunTrigger;
	private hintArgs: string[];
	private ignoreSeverity: boolean;
	private executable: string;
	private executableNotFound: boolean;
	private commandId:string;
	private command:vscode.Disposable;
	private documentListener: vscode.Disposable;
	private diagnosticCollection: vscode.DiagnosticCollection;
	private delayers: { [key: string]: ThrottledDelayer<void> };

	constructor() {
		this.executable = null;
		this.executableNotFound = false;
		this.trigger = RunTrigger.onSave;
		this.hintArgs = [];
		this.ignoreSeverity = false;
		this.commandId = 'haskell.runCodeAction'
		this.command = vscode.commands.registerCommand(this.commandId, this.runCodeAction, this);
	}

	public activate(subscriptions: vscode.Disposable[]) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection();
		subscriptions.push(this);
		vscode.workspace.onDidChangeConfiguration(this.loadConfiguration, this, subscriptions);
		this.loadConfiguration();

		vscode.workspace.onDidOpenTextDocument(this.triggerHlint, this, subscriptions);
		vscode.workspace.onDidCloseTextDocument((textDocument)=> {
			this.diagnosticCollection.delete(textDocument.uri);
			delete this.delayers[textDocument.uri.toString()];
		}, null, subscriptions);

		// Hlint all open haskell documents
		vscode.workspace.textDocuments.forEach(this.triggerHlint, this);
	}

	public dispose(): void {
		this.diagnosticCollection.clear();
		this.diagnosticCollection.dispose();
		this.command.dispose();
	}

	private loadConfiguration(): void {
		let section = vscode.workspace.getConfiguration('haskell');
		let oldExecutable = this.executable;
		if (section) {
			this.executable = section.get<string>('linter.executablePath', null);
			this.trigger = RunTrigger.from(section.get<string>('linter.run', RunTrigger.strings.onSave));
			this.hintArgs = section.get<string[]>('linter.hints', []).map(arg => { return `--hint=${arg}` });
			this.ignoreSeverity = section.get<boolean>('linter.ignoreSeverity', false);			
		}
		
		this.delayers = Object.create(null);
		if (this.executableNotFound) {
			this.executableNotFound = oldExecutable === this.executable;
		}
		if (this.documentListener) {
			this.documentListener.dispose();
		}
		if (this.trigger === RunTrigger.onType) {
			this.documentListener = vscode.workspace.onDidChangeTextDocument((e) => {
				this.triggerHlint(e.document);
			});
		} else {
			this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerHlint, this);
		}		
		this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerHlint, this);
		// Configuration has changed. Reevaluate all documents.
		vscode.workspace.textDocuments.forEach(this.triggerHlint, this);
	}

	private triggerHlint(textDocument: vscode.TextDocument): void {
		if (textDocument.languageId !== 'haskell' || this.executableNotFound) {
			return;
		}
		let key = textDocument.uri.toString();
		let delayer = this.delayers[key];
		if (!delayer) {
			delayer = new ThrottledDelayer<void>(this.trigger === RunTrigger.onType ? 250 : 0);
			this.delayers[key] = delayer;
		}
		delayer.trigger(() => this.doHlint(textDocument) );
	}

	private doHlint(textDocument: vscode.TextDocument): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let executable = this.executable || 'hlint';
			let filePath = textDocument.fileName;
			let decoder = new LineDecoder();
			let decoded = []
			let diagnostics: vscode.Diagnostic[] = [];
			let processLine = (item: LintItem) => {
				if (item) {
					diagnostics.push(HaskellLintingProvider._asDiagnostic(item, this.ignoreSeverity));
				}
			}

			let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;
			let args: string[];
			if (this.trigger === RunTrigger.onSave) {
				args = HaskellLintingProvider.FileArgs.slice(0);
				args.push(textDocument.fileName);
			} else {
				args = HaskellLintingProvider.BufferArgs;
			}			
			args = args.concat(this.hintArgs);
			
			let childProcess = cp.spawn(executable, args, options);
			childProcess.on('error', (error: Error) => {
				if (this.executableNotFound) {
					resolve();
					return;
				}
				let message: string = null;
				if ((<any>error).code === 'ENOENT') {
					message = `Cannot hlint the haskell file. The hlint program was not found. Use the 'haskell.hlint.executablePath' setting to configure the location of 'hlint'`;
				} else {
					message = error.message ? error.message : `Failed to run hlint using path: ${executable}. Reason is unknown.`;
				}
				vscode.window.showInformationMessage(message);
				this.executableNotFound = true;
				resolve();
			});
			if (childProcess.pid) {
                if (this.trigger === RunTrigger.onType) {
					childProcess.stdin.write(textDocument.getText());
					childProcess.stdin.end();
				}
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
	
	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.Command[] {
		let diagnostic:vscode.Diagnostic = context.diagnostics[0];
		// TODO: Return multiple commands if there are multiple issues
		if (diagnostic.message.indexOf('Parse error') !== 0) {
			return [<vscode.Command>{
				title: "Accept hlint suggestion",
				command: this.commandId,
				arguments: [document.getText(range), document.uri, diagnostic.range, diagnostic.message]
			}];
		}
	}
	
	private runCodeAction(text: string, uri:vscode.Uri, range: any, message:string, test): any {
		let fromRegex:RegExp = /.*Replace:(.*)==>.*/g
		let fromMatch:RegExpExecArray = fromRegex.exec(message.replace(/\s/g, ''));
		let from = fromMatch[1];
		let to:string = text.replace(/\s/g, '')
		if (from === to) {
			let newText = /.*==>\s(.*)/g.exec(message)[1]
			let edit = new vscode.WorkspaceEdit();
            let newRange = new vscode.Range(range.startLineNumber - 1, range.startColumn - 1, range.endLineNumber - 1, range.endColumn - 1);
			edit.replace(uri, newRange, newText);
            try {
			 var ret = vscode.workspace.applyEdit(edit);
            } catch (error) {
                console.log(error);
            }
		} else {
			vscode.window.showErrorMessage("The suggestion was not applied because it is out of date. You might have tried to apply the same edit twice.");
		}
	}
	
	private static _asDiagnostic(lintItem: LintItem, ignoreSeverity:boolean): vscode.Diagnostic {
		let severity = ignoreSeverity ? vscode.DiagnosticSeverity.Warning : this._asDiagnosticSeverity(lintItem.severity);
		let message = lintItem.hint + ". Replace: " + lintItem.from + " ==> " + lintItem.to;
		return new vscode.Diagnostic(this._getRange(lintItem), message, severity);
	}

	private static _asDiagnosticSeverity(logLevel: string): vscode.DiagnosticSeverity {
		switch (logLevel.toLowerCase()) {
			case 'warning':
				return vscode.DiagnosticSeverity.Warning;
			default:
				return vscode.DiagnosticSeverity.Error;
		}
	}
    private static _getRange(item: LintItem): vscode.Range {
		return new vscode.Range(item.startLine - 1, item.startColumn - 1, item.endLine - 1, item.endColumn - 1);
	}
}

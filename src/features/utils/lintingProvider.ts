'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import ChildProcess = cp.ChildProcess;
import { NodeStringDecoder, StringDecoder } from 'string_decoder';

import * as vscode from 'vscode';

import { ThrottledDelayer } from './async';

interface LinterOptions {
	executable:string,
	fileArgs:string[],
	bufferArgs:string[],
	runTrigger:string,
	processTrigger:string,
	extraArgs:string[]
}

class LineDecoder {
	private stringDecoder: NodeStringDecoder;
	private remaining: string;
	private lines: string[]

	constructor(encoding: string = 'utf8') {
		this.stringDecoder = new StringDecoder(encoding);
		this.remaining = null;
		this.lines = [];
	}

	public write(buffer: NodeBuffer): string[] {
		var result: string[] = [];
		var value = this.remaining
			? this.remaining + this.stringDecoder.write(buffer)
			: this.stringDecoder.write(buffer);

		if (value.length < 1) {
			this.lines = this.lines.concat(value)
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
		this.lines = this.lines.concat(value)
		return result;
	}

	public end(): string[] {
		let remainingArr = [ this.remaining ];
		this.lines = this.lines.concat(remainingArr)
		return [ this.remaining ];
	}
	
	public getLines(): string[] {
		return this.lines;
	}
}

enum RunTrigger {
	onSave,
	onType,
	off
}

namespace RunTrigger {
	export let strings = {
		onSave: 'onSave',
		onType: 'onType',
		off: 'off'
	}
	export let from = function(value: string): RunTrigger {
		if (value === 'onType') {
			return RunTrigger.onType;
		} else if (value === 'onSave') {
			return RunTrigger.onSave;
		} else {
			return RunTrigger.off;
		}
	}
}

enum ProcessTrigger {
	line,
	all
}

namespace ProcessTrigger {
	export let strings = {
		line: 'line',
		all: 'all'
	}
	export let from = function(value: string): ProcessTrigger {
		if (value === 'line') {
			return ProcessTrigger.line;
		} else {
			return ProcessTrigger.all;
		}
	}
}

export class LintingProvider {

	protected fileArgs: string[];
	protected bufferArgs: string[];
	protected extraArgs: string[];
	protected defaultOptions: LinterOptions;
	
	public languageId: string;
	protected ignoreSeverity: boolean;
	
	protected executable: string;
	protected runTrigger: RunTrigger;
	protected processTrigger: ProcessTrigger;
	protected executableNotFound: boolean;
	
	private documentListener: vscode.Disposable;
	private diagnosticCollection: vscode.DiagnosticCollection;
	private delayers: { [key: string]: ThrottledDelayer<void> };
	
	constructor() {
		this.executable = null;
		this.executableNotFound = false;
		this.runTrigger = RunTrigger.onSave;
		this.processTrigger = ProcessTrigger.all;
		this.extraArgs = [];
		this.ignoreSeverity = false;
		this.defaultOptions = null;
	}

	public activate(subscriptions: vscode.Disposable[]) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection();
		subscriptions.push(this);
		vscode.workspace.onDidChangeConfiguration(this.loadConfiguration, this, subscriptions);
		this.loadConfiguration();

		vscode.workspace.onDidOpenTextDocument(this.triggerLint, this, subscriptions);
		vscode.workspace.onDidCloseTextDocument((textDocument)=> {
			this.diagnosticCollection.delete(textDocument.uri);
			delete this.delayers[textDocument.uri.toString()];
		}, null, subscriptions);

		// Hlint all open documents documents
		vscode.workspace.textDocuments.forEach(this.triggerLint, this);
	}

	public dispose(): void {
		this.diagnosticCollection.clear();
		this.diagnosticCollection.dispose();
	}

	public processLine(line: string):vscode.Diagnostic {
		return;
	}
	
	public processAll(line: string[]):vscode.Diagnostic[] {
		return;
	}
	
	// public loadCustomConfiguration(): void {
	// 	return;
	// }

	private loadConfiguration(): void {
		let section = vscode.workspace.getConfiguration(this.languageId);
		let oldExecutable = this.executable;
		if (section) {
			this.executable = section.get<string>('linter.executablePath', this.defaultOptions.executable);
			this.fileArgs = section.get<string[]>('linter.fileArgs', this.defaultOptions.fileArgs);
			this.bufferArgs = section.get<string[]>('linter.bufferArgs', this.defaultOptions.bufferArgs);
			this.runTrigger = RunTrigger.from(section.get<string>('linter.run', this.defaultOptions.runTrigger));
			this.processTrigger = ProcessTrigger.from(section.get<string>('linter.process', this.defaultOptions.processTrigger));
			this.extraArgs = section.get<string[]>('linter.args', this.defaultOptions.extraArgs);
		}
		
		// this.loadCustomConfiguration();
		
		this.delayers = Object.create(null);
		if (this.executableNotFound) {
			this.executableNotFound = oldExecutable === this.executable;
		}
		if (this.documentListener) {
			this.documentListener.dispose();
		}
		if (this.runTrigger === RunTrigger.onType) {
			this.documentListener = vscode.workspace.onDidChangeTextDocument((e) => {
				this.triggerLint(e.document);
			});
		} else {
			this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerLint, this);
		}		
		this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerLint, this);
		// Configuration has changed. Reevaluate all documents.
		vscode.workspace.textDocuments.forEach(this.triggerLint, this);
	}

	private triggerLint(textDocument: vscode.TextDocument): void {
		if (textDocument.languageId !== this.languageId || this.executableNotFound || this.runTrigger === RunTrigger.off){
			return;
		}
		let key = textDocument.uri.toString();
		let delayer = this.delayers[key];
		if (!delayer) {
			delayer = new ThrottledDelayer<void>(this.runTrigger === RunTrigger.onType ? 250 : 0);
			this.delayers[key] = delayer;
		}
		delayer.trigger(() => this.doLint(textDocument) );
	}

	private doLint(textDocument: vscode.TextDocument): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let executable = this.executable; // TODO - MAKE SURE CONFIGURATION WORKS
			let filePath = textDocument.fileName;
			let decoder = new LineDecoder();
			let decoded = []
			let diagnostics: vscode.Diagnostic[] = [];
			
			let options = vscode.workspace.rootPath ? { cwd: vscode.workspace.rootPath } : undefined;
			let args: string[];
			if (this.runTrigger === RunTrigger.onSave) {
				args = this.fileArgs.slice(0);
				args.push(textDocument.fileName);
			} else {
				args = this.bufferArgs;
			}			
			args = args.concat(this.extraArgs);
			
			let childProcess = cp.spawn(executable, args, options);
			childProcess.on('error', (error: Error) => {
				if (this.executableNotFound) {
					resolve();
					return;
				}
				let message: string = null;
				if ((<any>error).code === 'ENOENT') {
					message = `Cannot lint ${textDocument.fileName}. The executable was not found. Use the '${this.languageId}.executablePath' setting to configure the location of the executable`;
				} else {
					message = error.message ? error.message : `Failed to run executable using path: ${executable}. Reason is unknown.`;
				}
				vscode.window.showInformationMessage(message);
				this.executableNotFound = true;
				resolve();
			});
			if (childProcess.pid) {
				if (this.runTrigger === RunTrigger.onType) {
					childProcess.stdin.write(textDocument.getText());
					childProcess.stdin.end();
				}
				childProcess.stdout.on('data', (data: Buffer) => {
					// decoder.write(data).forEach(line => diagnostics.push(this.processLine(line)) );
					decoder.write(data);
				});
				childProcess.stdout.on('end', () => {
					decoder.end();
					if(this.processTrigger === ProcessTrigger.line) {
						decoder.getLines().forEach(line => {
							diagnostics.push(this.processLine(line));
						});
					} else {
						diagnostics = this.processAll(decoder.getLines());
					}
					this.diagnosticCollection.set(textDocument.uri, diagnostics);
					resolve();
				});
			} else {
				resolve();
			}
		});
	}
}

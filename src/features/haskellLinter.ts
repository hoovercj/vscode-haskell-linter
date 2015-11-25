'use strict';
import * as vscode from 'vscode';

import { LintingProvider } from './utils/lintingProvider';

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

export default class HaskellLintingProvider extends LintingProvider {


	constructor() {
		super();
		this.languageId = 'haskell';
		this.defaultOptions = {
			executable: 'hlint',
			fileArgs: ['--json'],
			bufferArgs: ['--json', '-'],
			runTrigger: 'onType',
			processTrigger: 'all',
			extraArgs: []
		};
	}
	
	public processAll(lines: string[]): vscode.Diagnostic[] {
		let diagnostics: vscode.Diagnostic[] = [];
		JSON.parse(lines.join('')).forEach((item:LintItem) => {
			if (item) {
				diagnostics.push(HaskellLintingProvider._asDiagnostic(item, this.ignoreSeverity));
			}
		});
		return diagnostics;
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

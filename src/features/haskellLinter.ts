'use strict';
import { workspace, Disposable, Diagnostic, DiagnosticSeverity, Range } from 'vscode';

import { LintingProvider, LinterConfiguration, Linter } from './utils/lintingProvider';

export default class HaskellLintingProvider implements Linter {

	public loadConfiguration():LinterConfiguration {
		let section = workspace.getConfiguration(this.languageId);
		if (!section) return null;
	
		return {
			executable: section.get<string>('linter.executablePath', 'hlint'),
			fileArgs: section.get<string[]>('linter.fileArgs', ['--json']),
			bufferArgs: section.get<string[]>('linter.bufferArgs', ['--json', '-']),
			extraArgs: section.get<string[]>('linter.args', []),				
			runTrigger: section.get<string>('linter.run', 'onType'),
			ignoreSeverity: section.get<boolean>('linter.ignoreSeverity', false)
		}		
	}

	public languageId = 'haskell';
	private lintingProvider:LintingProvider;
	
	public activate(subscriptions: Disposable[]) {
		this.lintingProvider = new LintingProvider(this);
		this.lintingProvider.activate(subscriptions);
	}
	
	public process(lines: string[]): Diagnostic[] {
		let diagnostics: Diagnostic[] = [];
		JSON.parse(lines.join('')).forEach((item:LintItem) => {
			if (item) {
				diagnostics.push(HaskellLintingProvider._asDiagnostic(item, this.lintingProvider.linterConfiguration.ignoreSeverity));
			}
		});
		return diagnostics;
	}
	
	private static _asDiagnostic(lintItem: LintItem, ignoreSeverity:boolean): Diagnostic {
		let severity = ignoreSeverity ? DiagnosticSeverity.Warning : this._asDiagnosticSeverity(lintItem.severity);
		let message = lintItem.hint + ". Replace: " + lintItem.from + " ==> " + lintItem.to;
		return new Diagnostic(this._getRange(lintItem), message, severity);
	}

	private static _asDiagnosticSeverity(logLevel: string): DiagnosticSeverity {
		switch (logLevel.toLowerCase()) {
			case 'warning':
				return DiagnosticSeverity.Warning;
			default:
				return DiagnosticSeverity.Error;
		}
	}
    private static _getRange(item: LintItem): Range {
		return new Range(item.startLine - 1, item.startColumn - 1, item.endLine - 1, item.endColumn - 1);
	}
}

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

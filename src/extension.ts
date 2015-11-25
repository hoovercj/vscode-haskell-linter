// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'; 

import HaskellLintingProvider from './features/haskellLinter';

export function activate(context: vscode.ExtensionContext) {	
	let linter = new HaskellLintingProvider();	
	linter.activate(context.subscriptions);
}

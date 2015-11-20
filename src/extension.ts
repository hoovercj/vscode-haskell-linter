// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'; 

import HaskellValidationProvider from './features/validationProvider';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const _selector: vscode.DocumentSelector = {
		language: 'haskell',
		scheme: 'file' // only files from disk
	};
	
	let validator = new HaskellValidationProvider();	
	validator.activate(context.subscriptions);
	vscode.languages.registerCodeActionsProvider(_selector, validator);
}
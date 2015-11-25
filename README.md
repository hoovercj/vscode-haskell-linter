# README

"haskell-linter" is a wrapper for [hlint](http://community.haskell.org/~ndm/hlint/). It highlights hlint warnings and errors inline and provides a code-action to accept hlint suggestions.

It expects hlint to be installed and already added to the path. If it is installed but cannot be found, add the path to your preferences as seen below.

```json
{
	"haskell.hlint.executablePath": "PathToExecutable"
}
```

![IDE](https://media.giphy.com/media/l41lUI8WUMfgNlfvq/giphy.gif)

## Configuration:
There are various options that can be configured by making changes to your user or workspace preferences.

### Lint onType or onSave
By default the linter will lint when the file is saved. This is most useful when auto-save is on. Use the setting below if you want to keep auto-save off but lint automatically as you type.

```json
{
	"haskell.hlint.run": "onType"
}
```

### Hints
By default the linter simply calls the `hlint` command without arguments. To specify which hints to use, add an array of hint names like shown below.
 
```json
{
	"haskell.hlint.hints": ["Default", "Dollar", "Generalise"]
}
```

### Severity
By default, the severity levels returned by `hlint` are respected. That means that they will show as `error` and `warning`. To make all `hlint` suggestions act have a severity level of `Warning`, use the setting below.

```json
{
	"haskell.hlint.ignoreSeverity": true 
}
```

## Acknowledgements
The extension architecture is based off of the PHPValidationProvider from the built-in [php extension](https://github.com/Microsoft/vscode/tree/master/extensions/php).

## TODO:
- Improve suggestions to be able to pick from multiple suggestions at the same range.
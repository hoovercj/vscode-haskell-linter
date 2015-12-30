# README

## Changelog
__0.0.2__:
- Fixed configuration, setting `haskell.hlint.executablePath` should work
- Fixed code actions in response to [this VS Code issue](https://github.com/Microsoft/vscode/issues/1698)
- Made issues more readable
- Get information/choose from multiple suggestions
- Default linting is now onType
- Removed ignoreSeverity setting

## Overview
"haskell-linter" is a wrapper for [hlint](http://community.haskell.org/~ndm/hlint/). It highlights hlint warnings and errors inline and provides a code-action to accept hlint suggestions.

It expects hlint to be installed and already added to the path. If it is installed but cannot be found, add the path to your preferences as seen below.

```json
{
	"haskell.hlint.executablePath": "Path\To\Executable"
}
```

![IDE](images/animation.gif)

## Configuration:
There are various options that can be configured by making changes to your user or workspace preferences.

### Lint onType or onSave
By default the linter will lint as you type. Alternatively, use the setting below if you want to lint only when the file is saved. This will work best if auto-save is on.

```json
{
	"haskell.hlint.run": "onSave"
}
```

### Hints
By default the linter simply calls the `hlint` command without arguments. To specify which hints to use, add an array of hint names like shown below.
 
```json
{
	"haskell.hlint.hints": ["Default", "Dollar", "Generalise"]
}
```

## Acknowledgements
The extension architecture is based off of the PHPValidationProvider from the built-in [php extension](https://github.com/Microsoft/vscode/tree/master/extensions/php).

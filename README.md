# README

"haskell-linter" is a wrapper for [hlint](http://community.haskell.org/~ndm/hlint/). It highlights hlint warnings and errors inline and provides a code-action to accept hlint suggestions.  

The extension architecture is based off of the PHPValidationProvider from the built-in [php extension](https://github.com/Microsoft/vscode/tree/master/extensions/php).

TODO:  
- Lint from stdin
- Provide configuration for linting on save or linting on type
- Allow hint configuration
- Allow configuration of severity levels (i.e. show as hints or as warnings/errors)
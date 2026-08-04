node "../GrammarParser/GrammarParser/compileGrammar" grammar/tricz.grammar grammar/parse.js
echo "export { parse, AST };" >> grammar/parse.js
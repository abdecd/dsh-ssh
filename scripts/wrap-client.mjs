import { readFileSync, writeFileSync } from 'node:fs'

export function wrapClient(inputPath, outputPath) {
  const body = readFileSync(inputPath, 'utf8')
  const wrapped = `// dsh-ssh client bundle
window.__ModuleLoader__.load({
  id: 'dsh-ssh',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
${indent(body, 4)}
    return module.exports;
  }
});
`
  writeFileSync(outputPath, wrapped, 'utf8')
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n')
}

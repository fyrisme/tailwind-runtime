// Fills in `// ->` comments in the README with the results of running the code blocks

/// <reference types="vite/client" />

import { TailwindRuntime } from '../src/index.js';

import readme from '../README.md?raw';

// Group readme into lines starting at ```ts and ending at ```
const lines = readme.split('\n');
let blocks = [];

// [Starting line number, lines]
let currentBlock: [number, string[]];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!currentBlock && line.startsWith('```ts')) {
    currentBlock = [i, []];
  } else if (currentBlock && line.startsWith('```')) {
    blocks.push(currentBlock);
    currentBlock = undefined;
  } else if (currentBlock) {
    currentBlock[1].push(line);
  }
}

// Only keep blocks with a // -> comment
blocks = blocks.filter(([_, block]) =>
  block.some((line) => line.startsWith('// ->'))
);

// Make values pretty
function serialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(', ')}]`;
  }

  if (typeof value === 'object') {
    const pairs = Object.entries(value).map(
      ([key, value]) => `${key}: ${serialize(value)}`
    );
    return `{${pairs.join(', ')}}`;
  }

  if (typeof value === 'string') return `'${value}'`;

  return value;
}

// Load the library and run each code block, filling in the lines with the results
const tw = new TailwindRuntime();

for (const [startLine, block] of blocks) {
  const log = (value, line) => {
    value = serialize(value);
    lines[startLine + line] = `// -> ${value}`;
  };

  // Wrap lines before ones starting with  // -> comments in a log call
  for (let i = 0; i < block.length; i++) {
    if (block[i].startsWith('// ->')) {
      block[i - 1] = `log(${block[i - 1].replace(';', '')}, ${i + 1});`;
    }
  }

  eval(block.join('\n'));
}

// Replace the document body with updated markdown
document.body.innerHTML = lines.join('\n');

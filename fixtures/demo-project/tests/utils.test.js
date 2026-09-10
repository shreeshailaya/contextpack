const { greet } = require('../src/utils');

test('greet returns greeting', () => {
  expect(greet('World')).toBe('Hello, World!');
});

test('greet with empty string', () => {
  expect(greet('')).toBe('Hello, !');
});

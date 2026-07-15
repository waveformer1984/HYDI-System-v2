let counter = 0;
module.exports = {
  v4: () => `test-uuid-${(++counter).toString(16).padStart(8, '0')}`,
};

const codeMap = new Map();

exports.saveCode = (email, code) => {
  codeMap.set(email, { code, createdAt: Date.now() });
};

exports.getCode = (email) => {
  return codeMap.get(email);
};

exports.removeCode = (email) => {
  codeMap.delete(email);
};

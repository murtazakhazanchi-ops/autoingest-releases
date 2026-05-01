class ContractError extends Error {
  constructor(type, code, message, meta = {}) {
    super(message);
    this.name = "ContractError";
    this.type = type;
    this.code = code;
    this.meta = meta;
  }

  toString() {
    return `[CONTRACT:${this.type}:${this.code}] ${this.message}`;
  }
}

function contractError(type, code, message, meta = {}) {
  return new ContractError(type, code, message, meta);
}

module.exports = {
  ContractError,
  contractError
};
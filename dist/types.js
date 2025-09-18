// Configuration error handling
export class ConfigurationError extends Error {
    details;
    constructor(details) {
        super(details.message);
        this.details = details;
        this.name = 'ConfigurationError';
    }
}
//# sourceMappingURL=types.js.map
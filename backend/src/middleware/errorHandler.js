import { HttpError } from '../utils/httpError.js';
export function errorHandler(err, _req, res, _next) {
    if (err instanceof HttpError) {
        res.status(err.statusCode).json({
            success: false,
            error: {
                code: err.code,
                message: err.message,
            },
        });
        return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Request body must be valid JSON',
            },
        });
        return;
    }
    if (typeof err === 'object' && err !== null && 'name' in err && err.name === 'MulterError') {
        res.status(413).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'The upload exceeds the size limit.',
            },
        });
        return;
    }
    console.error(err instanceof Error ? err.name : 'Unhandled error');
    res.status(500).json({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
        },
    });
}

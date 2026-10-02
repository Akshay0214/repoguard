export function getHealth(_req, res) {
    res.status(200).json({
        success: true,
        message: 'RepoGuard API is running',
        timestamp: new Date().toISOString(),
    });
}

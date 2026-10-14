exports.success = (data) => ({
    status: 'Success',
    data
});

exports.failure = (message) => ({
    status: 'Error',
    message
});
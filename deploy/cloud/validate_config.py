"""Reject invalid origins before interrupting the running application."""
import json
import sys
from urllib.parse import urlsplit


def origin(value):
    url = urlsplit(value)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment or value != 'https://' + url.netloc):
        raise ValueError('Use a complete HTTPS origin without a trailing slash or path')
    return value


def validate(config):
    env = config['services']['app']['environment']
    public = origin(env['WEB_ORIGIN'])
    admin, key = env.get('ADMIN_ORIGIN', ''), env.get('ADMIN_KEY', '')
    if bool(admin) != bool(key):
        raise ValueError('ADMIN_ORIGIN and ADMIN_KEY must be configured together')
    if admin:
        if origin(admin) != public:
            raise ValueError('This gateway serves admin on WEB_ORIGIN; use the same origin')
        if len(key) < 32:
            raise ValueError('ADMIN_KEY must contain at least 32 characters')
    return public


if __name__ == '__main__':
    try:
        print(validate(json.load(sys.stdin)))
    except (ValueError, KeyError, TypeError) as exc:
        sys.exit(str(exc))

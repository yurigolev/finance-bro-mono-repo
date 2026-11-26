"""Check FinanceBro's public endpoints and report results to Healthchecks.io."""

import http.client
import os
import re
import ssl
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

PROD_IP = '135.106.172.166'
PING_URL = re.compile(r'https://hc-ping\.com/[a-f0-9-]{36}')
CHECKS = {
    'https': 'HEALTHCHECKS_PROD_HTTPS_URL',
    'tls-warning': 'HEALTHCHECKS_PROD_TLS_WARNING_URL',
    'tls-critical': 'HEALTHCHECKS_PROD_TLS_CRITICAL_URL',
}


def inspect_production():
    connection = http.client.HTTPSConnection(PROD_IP, timeout=8, context=ssl.create_default_context())
    certificate_expiry = None
    try:
        connection.connect()
        certificate_expiry = ssl.cert_time_to_seconds(connection.sock.getpeercert()['notAfter'])
        for path, expected in (
            ('/', 200),
            ('/api/analytics/overview?period=current-month', 401),
        ):
            connection.request('GET', path)
            response = connection.getresponse()
            if response.status != expected:
                print(f'Unexpected production status: {response.status}, expected {expected}')
                return False, certificate_expiry
            response.read()
        return True, certificate_expiry
    except (OSError, http.client.HTTPException):
        print('Production connection or TLS verification failed')
        return False, certificate_expiry
    finally:
        connection.close()


def publish(url, healthy):
    transfer = Request(url if healthy else f'{url}/fail', data=b'', method='POST')
    with urlopen(transfer, timeout=8) as response:
        if response.status != 200:
            raise ValueError('Unexpected Healthchecks response')


def main():
    urls = {label: os.environ.get(secret, '') for label, secret in CHECKS.items()}
    if any(not PING_URL.fullmatch(url) for url in urls.values()):
        raise SystemExit('Missing or invalid production Healthchecks URLs')
    http_ok, expiry = inspect_production()
    outcomes = {'https': http_ok}
    if expiry is not None:
        hours_left = (expiry - time.time()) / 3600
        print(f'Production certificate has {hours_left:.1f} hours remaining')
        outcomes.update({'tls-warning': hours_left > 48, 'tls-critical': hours_left > 24})
    errors = []
    for label, healthy in outcomes.items():
        try:
            publish(urls[label], healthy)
            print(f'{label}: {"healthy" if healthy else "failed"}')
        except (OSError, URLError, ValueError):
            errors.append(label)
    if errors:
        raise SystemExit('Could not report checks: ' + ', '.join(errors))


if __name__ == '__main__':
    main()

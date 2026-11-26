"""Check FinanceBro's public endpoints and report results to Cronitor."""

import http.client
import os
import re
import ssl
import time
from urllib.error import URLError
from urllib.request import urlopen

PROD_IP = '135.106.172.166'
TELEMETRY_KEY = re.compile(r'[A-Za-z0-9_-]{16,80}')
CHECKS = {
    'https': 'financebro-prod-https',
    'tls-warning': 'financebro-prod-tls-48h',
    'tls-critical': 'financebro-prod-tls-24h',
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


def publish(key, check, healthy):
    url = f'https://cronitor.link/p/{key}/{check}'
    with urlopen(url if healthy else f'{url}?state=fail', timeout=8) as response:
        if response.status != 200:
            raise ValueError('Unexpected Cronitor response')


def main():
    key = os.environ.get('CRONITOR_TELEMETRY_KEY', '')
    if not TELEMETRY_KEY.fullmatch(key):
        raise SystemExit('Missing or invalid Cronitor telemetry key')
    http_ok, expiry = inspect_production()
    outcomes = {'https': http_ok}
    if expiry is not None:
        hours_left = (expiry - time.time()) / 3600
        print(f'Production certificate has {hours_left:.1f} hours remaining')
        outcomes.update({'tls-warning': hours_left > 48, 'tls-critical': hours_left > 24})
    errors = []
    for label, healthy in outcomes.items():
        try:
            publish(key, CHECKS[label], healthy)
            print(f'{label}: {"healthy" if healthy else "failed"}')
        except (OSError, URLError, ValueError):
            errors.append(label)
    if errors:
        raise SystemExit('Could not report checks: ' + ', '.join(errors))


if __name__ == '__main__':
    main()

"""Deployment failure boundaries with isolated command stubs, no cloud access."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'registry.cn-hangzhou.aliyuncs.com/example/shadowtable@sha256:' + 'a' * 64


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.home = self.base / 'server'
        self.release = self.home / 'releases/new'
        self.old = self.home / 'releases/old'
        self.release.mkdir(parents=True)
        self.old.mkdir()
        (self.home / 'current').symlink_to(self.old)
        (self.old / 'compose.yaml').write_text('')
        for name in ['deploy.sh', 'compose.sh', 'validate_config.py']:
            (self.release / name).write_text((ROOT / 'deploy/cloud' / name).read_text().replace('/opt/shadowtable', str(self.home)))
        (self.old / 'compose.sh').write_text((self.release / 'compose.sh').read_text())
        (self.release / 'preflight.sh').write_text('exit 0\n')
        bin_dir = self.base / 'bin'
        bin_dir.mkdir()
        stubs = {
            'docker': '''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f: f.write(json.dumps(args) + '\\n')
mode = os.environ.get('FAIL_MODE', '')
new = any('/new/' in x for x in args)
if 'config' in args and 'json' in args:
    print(json.dumps({'services': {'app': {'environment': {'WEB_ORIGIN': os.environ.get('TEST_ORIGIN', 'https://table.example.com')}}}}))
if 'pull' in args and mode == 'pull': sys.exit(1)
if 'run' in args and 'node' in args and mode == 'permissions': sys.exit(1)
if 'tar' in args:
    print('backup')
    if mode == 'backup': sys.exit(1)
if 'up' in args and new and mode == 'startup': sys.exit(1)
''',
            'curl': '''#!/usr/bin/env python3
import os, sys
with open(os.environ['CALLS'] + '.curl', 'a') as f: f.write(' '.join(sys.argv[1:]) + '\\n')
if os.environ.get('FAIL_MODE') == 'public': sys.exit(7)
print('{"ok": true}')
''',
            'flock': '#!/bin/sh\nexit 0\n',
            'sleep': '#!/bin/sh\nexit 0\n',
        }
        for name, code in stubs.items():
            file = bin_dir / name
            file.write_text(code)
            file.chmod(0o755)
        self.env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'], CALLS=str(self.base / 'calls'))

    def run_deploy(self, mode='', image=IMAGE):
        result = subprocess.run(['bash', str(self.release / 'deploy.sh'), image], env=dict(self.env, FAIL_MODE=mode), capture_output=True, text=True)
        log = self.base / 'calls'
        calls = [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
        return result, calls

    def test_success_backs_up_before_start_and_promotes(self):
        result, calls = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        stop = next(i for i, c in enumerate(calls) if 'stop' in c)
        backup = next(i for i, c in enumerate(calls) if 'tar' in c)
        up = next(i for i, c in enumerate(calls) if 'up' in c)
        self.assertLess(stop, backup)
        self.assertLess(backup, up)
        self.assertEqual((self.home / 'current').resolve(), self.release)
        self.assertEqual((self.home / 'previous').resolve(), self.old)
        self.assertEqual(len(list((self.home / 'backups').glob('*.tgz'))), 1)
        self.assertFalse(any('caddy' in c or 'proxy' in c for c in calls))

    def assert_rollback(self, mode):
        result, calls = self.run_deploy(mode)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.home / 'current').resolve(), self.old)
        self.assertTrue(any('up' in c and any('/old/' in a for a in c) for c in calls))
        self.assertFalse((self.home / 'previous').exists())
        return calls

    def test_backup_failure_restores_old_and_never_starts_candidate(self):
        calls = self.assert_rollback('backup')
        self.assertFalse(any('up' in c and any('/new/' in a for a in c) for c in calls))
        self.assertEqual(list((self.home / 'backups').iterdir()), [])

    def test_start_failure_restores_old(self):
        self.assert_rollback('startup')

    def test_public_failure_restores_old_with_bounded_retries(self):
        self.assert_rollback('public')
        self.assertEqual(len((self.base / 'calls.curl').read_text().splitlines()), 12)

    def test_pull_failure_preserves_running_app(self):
        result, calls = self.run_deploy('pull')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('stop' in c for c in calls))

    def test_unwritable_data_preserves_running_app(self):
        result, calls = self.run_deploy('permissions')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('stop' in c for c in calls))

    def test_bad_origin_preserves_running_app(self):
        self.env['TEST_ORIGIN'] = 'http://table.example.com'
        result, calls = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('stop' in c for c in calls))

    def test_mutable_image_rejected_before_docker(self):
        result, calls = self.run_deploy(image='example:latest')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_first_deployment_failure_stops_candidate(self):
        (self.home / 'current').unlink()
        result, calls = self.run_deploy('startup')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / 'current').exists())
        self.assertEqual(sum('stop' in c for c in calls), 2)
        self.assertFalse(any('up' in c and any('/old/' in a for a in c) for c in calls))

    def test_legacy_release_rejected_before_downtime(self):
        (self.old / 'compose.yaml').unlink()
        result, calls = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('stop' in c for c in calls))


class ConfigTest(unittest.TestCase):
    def test_admin_settings(self):
        spec = importlib.util.spec_from_file_location('deployment_config', ROOT / 'deploy/cloud/validate_config.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        env = {'WEB_ORIGIN': 'https://table.example.com', 'ADMIN_ORIGIN': 'https://table.example.com', 'ADMIN_KEY': 'a' * 64}
        config = {'services': {'app': {'environment': env}}}
        self.assertEqual(module.validate(config), env['WEB_ORIGIN'])
        for key, bad in [('ADMIN_KEY', ''), ('ADMIN_KEY', 'short'), ('ADMIN_ORIGIN', 'https://other.example.com')]:
            saved = env[key]
            env[key] = bad
            with self.assertRaises(ValueError): module.validate(config)
            env[key] = saved


if __name__ == '__main__':
    unittest.main()

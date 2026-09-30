"""Persist and verify the link between a successful CI run, revision and image."""
import json
import os
from pathlib import Path
import re
import sys
from validate_image import image_reference, repository


def configured_repository():
    parts = []
    for key in ('ACR_REGISTRY', 'ACR_NAMESPACE', 'ACR_REPOSITORY'):
        value = os.environ.get(key, '')
        if not value:
            raise ValueError(f'Missing repository variable: {key}')
        parts.append(value)
    return repository('/'.join(parts))


def resolve(metadata, revision, run_id, image_repository):
    image = image_reference(metadata['image'])
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Invalid source revision')
    if metadata['revision'] != revision or str(metadata['run_id']) != str(run_id):
        raise ValueError('Image metadata does not match the selected CI run')
    if image.split('@', 1)[0] != repository(image_repository):
        raise ValueError('Image metadata uses a different configured repository')
    return image


def output(key, value):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(f'{key}={value}\n')


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        name = configured_repository()
        if command == 'repository':
            output('registry', name.split('/', 1)[0])
            output('repository', name)
        elif command == 'create':
            image = image_reference(name + '@' + os.environ['IMAGE_DIGEST'])
            metadata = {'image': image, 'revision': os.environ['GITHUB_SHA'], 'run_id': os.environ['GITHUB_RUN_ID']}
            path = Path(sys.argv[2])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(metadata, indent=2) + '\n')
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
                stream.write(f'Image: `{image}`\n\nBuild run ID: `{metadata["run_id"]}`\n\nUse **Deploy tested image** to select a target.\n')
        elif command == 'resolve':
            image = resolve(json.loads(Path(sys.argv[2]).read_text()), os.environ['EXPECTED_REVISION'], os.environ['EXPECTED_RUN_ID'], name)
            output('image', image)
        else:
            raise ValueError('Unknown metadata command')
    except (ValueError, KeyError, IndexError, OSError) as exc:
        sys.exit(str(exc))

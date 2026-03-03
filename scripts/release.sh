#!/bin/bash

# Exit on error
set -e

if [ -z "$1" ]; then
    echo "Usage: ./scripts/release.sh <patch|minor|major>"
    exit 1
fi

BUMP=$1

# Ensure workspace is clean
if [ -n "$(git status --porcelain)" ]; then
    echo "Error: Working directory is not clean. Please commit or stash changes."
    exit 1
fi

# Run tests
echo "Running tests..."
npm test:run

# Bump version and build
echo "Bumping version ($BUMP)..."
npm version $BUMP -m "chore(release): %s"

# Push changes and tags
echo "Pushing to origin..."
git push origin $(git branch --show-current) --follow-tags

echo "Release complete! GitHub Actions will now publish to NPM."

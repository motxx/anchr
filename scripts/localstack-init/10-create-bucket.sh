#!/bin/sh
set -eu

awslocal s3 mb s3://human-calling >/dev/null 2>&1 || true

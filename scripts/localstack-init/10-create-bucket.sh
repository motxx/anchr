#!/bin/sh
set -eu

awslocal s3 mb s3://anchr >/dev/null 2>&1 || true

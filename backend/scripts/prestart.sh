#! /usr/bin/env bash

set -e
set -x

# Wait for the Azure SQL database to be reachable
python app/backend_pre_start.py

# Create schema (create_all) and seed initial data in DB
python app/initial_data.py

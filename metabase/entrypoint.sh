#!/bin/bash
echo "Starting Metabase..."
/app/run_metabase.sh &
METABASE_PID=$!
echo "Waiting for Metabase to start..."
sleep 30
echo "Running provisioning script..."
/app/provision.sh
echo "Provisioning completed. Metabase is ready."
wait $METABASE_PID
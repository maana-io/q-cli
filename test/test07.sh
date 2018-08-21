#
# Convert the WellConnected data to NDF and upload it to a Prisma endpoint
#
set -e

DATADIR=~/nas/donald/well_connected

# Run the Prisma service
(cd 07 && docker-compose up -d)

# Reset and update its datamodel
(cd 07 && prisma reset)
(cd 07 && prisma deploy)

# Get the (generated) schema
gql get-schema -p test07

# Convert the source data to NDF
gql mload -p test07 $DATADIR/General -n "07/_ndf/general"
gql mload -p test07 $DATADIR/Activity -n "07/_ndf/activity" -t Activity
gql mload -p test07 $DATADIR/Event -n "07/_ndf/event" -t Event
gql mload -p test07 $DATADIR/Observation -n "07/_ndf/observation" -t Observation
gql mload -p test07 $DATADIR/Problem -n "07/_ndf/problem" -t Problem

# Upload to the Prisma service
(cd 07 && prisma import -d ./_ndf/general)
(cd 07 && prisma import -d ./_ndf/activity)
(cd 07 && prisma import -d ./_ndf/event)
(cd 07 && prisma import -d ./_ndf/obervation)
(cd 07 && prisma import -d ./_ndf/problem)
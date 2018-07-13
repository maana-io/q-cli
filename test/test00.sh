set -e
gql maddsvc "cli.test00" -i "cli.test00" -s "00/model.gql" -p ckg
gql get-schema -p test00
gql mload "00/" -p test00

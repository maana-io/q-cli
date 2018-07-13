set -e
gql maddsvc "cli.test06" -i "cli.test06" -s "06/model.gql" -p ckg
gql get-schema -p test06
gql mload "06/data" -p test06

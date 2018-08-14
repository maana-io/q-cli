set -e
gql maddsvc "cli.test09" -i "cli.test09" -s "09/model.gql" -p ckg
gql get-schema -p test09
gql mload "09/data" -p test09

set -e
gql maddsvc "cli.test05" -i "cli.test05" -s "05/model.gql" -p ckg
gql get-schema -p test05
gql mload "05/" -p test05

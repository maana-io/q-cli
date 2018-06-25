set -e
gql maddsvc "dt.test05" -i "dt.test05" -s "05/model.gql" -p ckg
gql get-schema -p test05
gql mload "05/" -p test05

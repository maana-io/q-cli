set -e
gql maddsvc "dt.test00" -i "dt.test00" -s "00/model.gql" -p ckg
gql get-schema -p test00
gql mload "00/" -p test00

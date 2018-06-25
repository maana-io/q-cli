set -e
gql maddsvc "dt.test01" -i "dt.test01" -s "01/model.gql" -p ckg
gql get-schema -p test01
gql mload 01/Rig.json -p test01 -b 1000

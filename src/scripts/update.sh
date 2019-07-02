#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' 

serviceName="$1"
servicePath="$2"
registryPath="$3"
version="$4"
replicas="$5"

interval=5
max_attempts=100

tag=$registryPath/$serviceName:$version    

printf "\n${BLUE}Updating to: ${NC} $serviceName:$version${NC}\n"
kubectl set image deployment/$serviceName $serviceName=$tag
kubectl scale --replicas=0 deployment/$serviceName

kubectl scale --replicas=$replicas deployment/$serviceName

function __is_deployment_available() {
  [[ "$(kubectl get deployment "$serviceName" -o 'jsonpath={.status.conditions[?(@.type=="Available")].status}')" == 'True' ]]
}

pod_ready_attempt_counter=0
until __is_deployment_available; do
    if [ ${pod_ready_attempt_counter} -eq ${max_attempts} ];then
      echo "Max attempts reached"
      exit 1
    fi

    printf '.'
    attempt_counter=$(($attempt_counter+1))
    sleep $interval
done  
printf "\n${GREEN}Done updating${NC} $serviceName:$version${NC}\n"

ip=`kubectl get service $serviceName -o json -o 'jsonpath={.status.loadBalancer.ingress[].ip}'`  

printf "===========================================\n\n"
printf "The external IP address for ${BLUE}$serviceName:$version${NC} is:\n\n ${GREEN}$ip${NC}\n\n"
printf "The URL for your GraphQL endpoint is\n\n  ${GREEN}http://$ip:$port/graphql\n\n${NC}"  

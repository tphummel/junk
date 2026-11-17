#!/bin/bash

set -e

NAMESPACES=$(kubectl get ns -o jsonpath='{.items[*].metadata.name}')

for ns in $NAMESPACES; do
  echo "----------------------"
  echo "🐿️ Namespace: $ns"
  
  RESOURCES=$(kubectl api-resources --verbs=list --namespaced -o name)

  for resource in $RESOURCES; do
    RESOURCE_COUNT=$(kubectl -n $ns get $resource --no-headers 2>/dev/null | wc -l)
    if [ $RESOURCE_COUNT -gt 0 ]; then
      echo "Resource Type: $resource"
      kubectl -n $ns get $resource
      echo
    fi
  done
done

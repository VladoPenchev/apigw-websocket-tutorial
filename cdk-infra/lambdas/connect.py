"""
extract connection id and write to dynamodb
"""
import os
import boto3

ddb = boto3.resource('dynamodb')
connections_table = ddb.Table(os.environ['CONNECTIONS_TABLE'])

def handler(event, context):
  print(event)

  try:
    connection_id = event['requestContext']['connectionId']
    connections_table.put_item(Item={'connectionId': connection_id})
  except Exception as e:
    print(e)
    return {'statusCode': 500}
  return {'statusCode': 200}
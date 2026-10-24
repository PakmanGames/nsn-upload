import type { MappingRecord } from './types';

export const demoMappings: MappingRecord[] = [
	{
		id: 'demo-1',
		part: 'M30294',
		description: 'Bolt, hex head, 1/4-20',
		nsn: '1560000000047',
		niin: '000000047',
		cage: '12345',
		status: 'Enriched',
		createdAt: '2026-07-18T16:30:00.000Z'
	},
	{
		id: 'demo-2',
		part: '7320651-J',
		description: 'Washer, flat, steel',
		niin: '000000048',
		cage: 'ABC12',
		status: 'Ready',
		createdAt: '2026-07-20T19:10:00.000Z'
	},
	{
		id: 'demo-3',
		description: 'Screw, machine, Phillips',
		nsn: '1560000000049',
		cage: '67890',
		status: 'Processing',
		createdAt: '2026-07-22T14:05:00.000Z'
	},
	{
		id: 'demo-4',
		part: 'NAS1149F0332P',
		description: 'Washer, flat',
		cage: '80205',
		status: 'Ready',
		createdAt: '2026-07-23T11:42:00.000Z'
	}
];
